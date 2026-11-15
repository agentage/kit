import { mkdir } from 'node:fs/promises';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createLog } from '../../log/log.js';
import { closeNow, listen } from '../../server/serve.js';
import { forkLaunch, type Launch } from './child.js';
import { pruneValues, removeDaemonFile, writeDaemonFile, DAEMON_PROTOCOL } from './daemon-files.js';
import { bootInstallation, keepBadCopy } from './installation.js';
import { type Entries } from './entries.js';
import { limitsOf, type Limits } from './limits.js';
import { pendingChanges } from './pending.js';
import { serialQueue } from './queue.js';
import { launchUnlessStopping, stopAll, stoppingOf, type Stopping } from './stopping.js';
import { daemonApp } from './routes.js';
import { runInstaller } from './installer-call.js';
import { halt, startEntry, type Entry, type Installer, type SupervisorDeps } from './supervisor.js';

export interface DaemonOptions extends Partial<Limits> {
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

// The valid rows of installation.json; a bad file is kept aside and reported in /health.
const loadEntries = async (configDir: string) => {
  const { doc, invalid, unreadable } = await bootInstallation(configDir);
  if (invalid) await keepBadCopy(configDir).catch(() => undefined);
  const entries: Entries = new Map();
  for (const install of doc.extensions) {
    const state = install.enabled === false ? 'disabled' : 'starting';
    entries.set(install.id, { id: install.id, install, state, version: install.version ?? '' });
  }
  return { entries, invalid, unreadable };
};

// A disabled entry gets its folder (configure and enable work); a failure is kept as its error.
const resolveDir = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  const { id, install } = entry;
  if (install.source) return void (entry.dir = install.source);
  await runInstaller(deps, { id, version: install.version }).then(
    (got) => void Object.assign(entry, { dir: got.dir, version: got.version, error: undefined }),
    (err: Error) => void (entry.error = err.message)
  );
};

// Enabled folders first (no installer), then enabled versions one at a time, disabled ones last.
const boot = async (deps: SupervisorDeps, entries: Entries): Promise<void> => {
  const all = [...entries.values()];
  const off = all.filter((e) => e.state === 'disabled');
  const on = all.filter((e) => e.state !== 'disabled');
  const ordered = [...on.filter((e) => e.install.source), ...on.filter((e) => !e.install.source)];
  for (const entry of ordered) await startEntry(deps, entry);
  for (const entry of off) await resolveDir(deps, entry);
};

// Only a clean list says which rows are orphans; a failed sweep is a warn line, not a failed boot.
const prune = (deps: SupervisorDeps, ids: string[]) =>
  pruneValues(deps.configDir, ids, deps.lockMs).catch((err: Error) =>
    deps.log.warn('orphan settings and secrets rows were not deleted', { reason: err.message })
  );

const stopper = (server: Server, entries: Entries, deps: SupervisorDeps, life: AbortController) => {
  let stopped: Promise<void> | undefined;
  const stop = async () => {
    life.abort();
    await Promise.all([...entries.values()].map((entry) => halt(entry, deps.drainMs)));
    await stopAll(deps.stopping);
    await closeNow(server);
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

const depsOf = (opts: DaemonOptions, launch: Launch, origin: () => string, stopping: Stopping) =>
  ({
    configDir: opts.configDir,
    launch: launchUnlessStopping(stopping, launch),
    stopping,
    install: opts.install,
    log: createLog({ extension: 'host', part: 'api', version: opts.version }),
    origin,
    ...limitsOf(opts),
    queue: serialQueue(),
    pending: pendingChanges(),
    unsynced: new Set<string>(),
  }) satisfies SupervisorDeps;

// Read and check the file, listen, write daemon.json, start the children; a failed boot undoes it.
export const startDaemon = async (opts: DaemonOptions, launch: Launch): Promise<Daemon> => {
  await mkdir(opts.configDir, { recursive: true });
  let port = opts.port ?? DAEMON_PORT;
  const life = new AbortController();
  const deps = depsOf(opts, launch, () => `http://127.0.0.1:${port}`, stoppingOf(life.signal));
  const { entries, ...file } = await loadEntries(opts.configDir);
  if (!file.invalid && !file.unreadable) await prune(deps, [...entries.keys()]);
  const info = { version: opts.version, pid: process.pid, protocol: DAEMON_PROTOCOL, ...file };
  const app = daemonApp(deps, entries, () => port, info);
  const server = await listen(app, port, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
  const stop = stopper(server, entries, deps, life);
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
  startDaemon(opts, forkLaunch(undefined, opts.startMs));
