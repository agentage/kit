import { mkdir } from 'node:fs/promises';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createLog } from '../../log/log.js';
import { closeNow, listen } from '../../server/serve.js';
import { forkLaunch, type Launch } from './child.js';
import { syncCliUser, watchCliUser } from './cli-user-watch.js';
import { removeDaemonFile, writeDaemonFile, DAEMON_PROTOCOL } from './daemon-files.js';
import { assertNoOtherDaemon } from './daemon-owner.js';
import { bootInstallation, updateInstallation } from './installation.js';
import { type Entries } from './entries.js';
import { newHostToken } from './host-token.js';
import { sealOffReason } from './seal.js';
import { limitsOf, type Limits } from './limits.js';
import { pendingChanges } from './pending.js';
import { serialQueue } from './queue.js';
import { launchUnlessStopping, stopAll, stoppingOf, type Stopping } from './stopping.js';
import { daemonApp } from './routes.js';
import { readShell } from './shell-routes.js';
import { runInstaller } from './installer-call.js';
import { repairReload } from './reload-marker.js';
import { halt } from './gate.js';
import { startEntry, type Entry, type Installer, type SupervisorDeps } from './supervisor.js';

export interface DaemonOptions extends Partial<Limits> {
  configDir: string;
  port?: number;
  install?: Installer;
  version: string;
  startedBy: string;
  // The test clock for every child (AGENTAGE_CLOCK_RATE); 1 when unset. createDaemon only.
  clockRate?: number;
  // The folder of the shell package (@agentage/shell-dashboard): / and /shell/* serve its dist/.
  shellDir?: string;
}

export interface Daemon {
  port: number;
  stop(): Promise<void>;
}

export const DAEMON_PORT = 4243;

const warnOf = (deps: SupervisorDeps) => (err: Error) =>
  deps.log.warn('a daemon file was not cleaned at boot', { reason: err.message });

// The valid rows of installation.json; a bad file is kept aside, replaced by them, and in /health.
const loadEntries = async (deps: SupervisorDeps) => {
  const { doc, invalid, unreadable } = await bootInstallation(deps.configDir);
  if (invalid) await updateInstallation(deps.configDir, () => doc, deps.lockMs).catch(warnOf(deps));
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
  for (const entry of all) await repairReload(deps.configDir, entry, deps.log).catch(warnOf(deps));
  for (const entry of ordered) await startEntry(deps, entry);
  for (const entry of off) await resolveDir(deps, entry);
};

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

// C4: how a client finds this daemon; D11: the host token, only in this 0600 file.
const announce = (
  { configDir, version, startedBy }: DaemonOptions,
  port: number,
  hostToken: string
) =>
  writeDaemonFile(configDir, {
    pid: process.pid,
    port,
    version,
    protocol: DAEMON_PROTOCOL,
    startedBy,
    hostToken,
  });

// One source: the launch that forks the children (its test clock, its seal).
const launchMarks = (launch: Launch) => ({
  ...(launch.clockRate && launch.clockRate !== 1 && { clockRate: launch.clockRate }),
  ...(launch.seal && { seal: launch.seal }),
  ...(launch.seal === 'off' && { sealError: sealOffReason(launch.node ?? process.versions.node) }),
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
    user: {},
  }) satisfies SupervisorDeps;

// A broken shell install costs the page, never the extensions.
const shellOf = (deps: SupervisorDeps, dir: string) =>
  readShell(dir).catch((err: Error) => {
    deps.log.warn('the shell package is not readable: no page at /', { reason: err.message });
    return undefined;
  });

// No other daemon, read and check the file, listen, write daemon.json, start the children; a failed boot undoes it.
export const startDaemon = async (opts: DaemonOptions, launch: Launch): Promise<Daemon> => {
  await mkdir(opts.configDir, { recursive: true });
  // A live daemon owns the folder: a second one fails before it writes any file there.
  await assertNoOtherDaemon(opts.configDir);
  let port = opts.port ?? DAEMON_PORT;
  const life = new AbortController();
  const deps = depsOf(opts, launch, () => `http://127.0.0.1:${port}`, stoppingOf(life.signal));
  const { entries, ...file } = await loadEntries(deps);
  const self = { version: opts.version, pid: process.pid, protocol: DAEMON_PROTOCOL };
  const shell = opts.shellDir ? { shell: await shellOf(deps, opts.shellDir) } : {};
  const info = { ...launchMarks(launch), ...self, ...file, ...shell };
  const hostToken = newHostToken();
  const app = daemonApp(deps, entries, () => port, info, hostToken);
  const server = await listen(app, port, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
  const stop = stopper(server, entries, deps, life);
  try {
    await announce(opts, port, hostToken);
    await deps.queue(() => syncCliUser(deps, entries));
    await deps.queue(() => boot(deps, entries));
    life.signal.addEventListener('abort', watchCliUser(deps, entries));
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, stop };
};

// One daemon on 127.0.0.1, one child process for each extension (D1); a bad clockRate rejects.
export const createDaemon = async (opts: DaemonOptions): Promise<Daemon> =>
  startDaemon(opts, forkLaunch(undefined, opts.startMs, opts.clockRate));
