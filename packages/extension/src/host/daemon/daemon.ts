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
import { keepBadCopy, readInstallation } from './installation.js';
import { type Entries } from './ops.js';
import { serialQueue } from './queue.js';
import { daemonApp } from './routes.js';
import {
  DRAIN_MS,
  HEALTH_MS,
  halt,
  startEntry,
  type Installer,
  type SupervisorDeps,
} from './supervisor.js';

export interface DaemonOptions {
  configDir: string;
  port?: number;
  install?: Installer;
  version: string;
  startedBy: string;
  // How long an old child's open requests may take (10 s), and a new child's /health (60 s).
  drainMs?: number;
  healthMs?: number;
}

export interface Daemon {
  port: number;
  stop(): Promise<void>;
}

export const DAEMON_PORT = 4243;

// The valid rows of installation.json; a bad file is kept aside and reported in /health.
const loadEntries = async (configDir: string): Promise<{ entries: Entries; invalid: boolean }> => {
  const { doc, invalid } = await readInstallation(configDir);
  if (invalid) await keepBadCopy(configDir).catch(() => undefined);
  const entries: Entries = new Map();
  for (const install of doc.extensions) {
    const state = install.enabled === false ? 'disabled' : 'starting';
    entries.set(install.id, { id: install.id, install, state, version: install.version ?? '' });
  }
  return { entries, invalid };
};

// One at a time, so the installer is never called twice at once; a failed one stops no other.
const boot = async (deps: SupervisorDeps, entries: Entries): Promise<void> => {
  for (const entry of entries.values())
    if (entry.state === 'starting') await startEntry(deps, entry);
};

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

const stopper = (server: Server, entries: Entries, deps: SupervisorDeps) => {
  let stopped: Promise<void> | undefined;
  const stop = async () => {
    await Promise.all([...entries.values()].map((entry) => halt(entry, deps.drainMs)));
    await close(server);
    await removeDaemonFile(deps.configDir);
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

const depsOf = (opts: DaemonOptions, launch: Launch, origin: () => string): SupervisorDeps => ({
  configDir: opts.configDir,
  launch,
  install: opts.install,
  log: createLog({ extension: 'host', part: 'api', version: opts.version }),
  origin,
  drainMs: opts.drainMs ?? DRAIN_MS,
  healthMs: opts.healthMs ?? HEALTH_MS,
  queue: serialQueue(),
});

// Read and check the file, listen, write daemon.json, start the children; a failed boot undoes it.
export const startDaemon = async (opts: DaemonOptions, launch: Launch): Promise<Daemon> => {
  await ensureConfigDir(opts.configDir);
  let port = opts.port ?? DAEMON_PORT;
  const deps = depsOf(opts, launch, () => `http://127.0.0.1:${port}`);
  const { entries, invalid } = await loadEntries(opts.configDir);
  const info = { version: opts.version, pid: process.pid, protocol: DAEMON_PROTOCOL, invalid };
  const app = daemonApp(deps, entries, () => port, info);
  const server = await listen(app, port, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
  const stop = stopper(server, entries, deps);
  try {
    await announce(opts, port);
    await deps.queue(() => boot(deps, entries));
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, stop };
};

// One daemon on 127.0.0.1, one child process for each extension (D1).
export const createDaemon = (opts: DaemonOptions): Promise<Daemon> =>
  startDaemon(opts, forkLaunch());
