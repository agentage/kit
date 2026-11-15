import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createLog } from '../../log/log.js';
import { listen } from '../../server/serve.js';
import { forkLaunch, type Launch } from './child.js';
import {
  ensureConfigDir,
  removeDaemonFile,
  writeDaemonFile,
  DAEMON_PROTOCOL,
} from './daemon-files.js';
import { readInstallation } from './installation.js';
import { type Entries } from './ops.js';
import { daemonApp } from './routes.js';
import { halt, startEntry, type Entry, type Installer, type SupervisorDeps } from './supervisor.js';

export interface DaemonOptions {
  configDir: string;
  port?: number;
  install?: Installer;
  version: string;
  startedBy: string;
}

export interface Daemon {
  port: number;
  stop(): Promise<void>;
}

export const DAEMON_PORT = 4243;

// Each extension of installation.json; one that fails to start is failed, the others run.
const boot = async (deps: SupervisorDeps, entries: Entries): Promise<void> => {
  const { extensions } = await readInstallation(deps.configDir);
  for (const install of extensions) {
    const state = install.enabled === false ? 'disabled' : 'starting';
    entries.set(install.id, {
      id: install.id,
      install,
      state,
      version: install.version ?? '',
    });
  }
  const starting = [...entries.values()].filter((e) => e.state === 'starting');
  await Promise.all(starting.map((entry: Entry) => startEntry(deps, entry)));
};

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

const stopper = (server: Server, entries: Entries, configDir: string) => {
  let stopped: Promise<void> | undefined;
  const stop = async () => {
    await Promise.all([...entries.values()].map((entry) => halt(entry)));
    await close(server);
    await removeDaemonFile(configDir);
  };
  return () => (stopped ??= stop());
};

// C4: how a client finds this daemon.
const announce = ({ configDir, version, startedBy }: DaemonOptions, port: number) =>
  writeDaemonFile(configDir, {
    pid: process.pid,
    port,
    version,
    protocol: DAEMON_PROTOCOL,
    startedBy,
  });

// The daemon with the children launched by launch (tests start them in this process).
export const startDaemon = async (opts: DaemonOptions, launch: Launch): Promise<Daemon> => {
  await ensureConfigDir(opts.configDir);
  const log = createLog({ extension: 'host', part: 'api', version: opts.version });
  let port = opts.port ?? DAEMON_PORT;
  const origin = () => `http://127.0.0.1:${port}`;
  const { configDir, install } = opts;
  const deps: SupervisorDeps = { configDir, launch, install, log, origin };
  const entries: Entries = new Map();
  const app = daemonApp(deps, entries, () => port, opts.version);
  const server = await listen(app, port, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
  await announce(opts, port);
  await boot(deps, entries);
  return { port, stop: stopper(server, entries, opts.configDir) };
};

// One daemon on 127.0.0.1, one child process for each extension (D1).
export const createDaemon = (opts: DaemonOptions): Promise<Daemon> =>
  startDaemon(opts, forkLaunch());
