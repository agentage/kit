import { fail } from '../../envelope/envelope.js';
import { type Log } from '../../log/log.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Exit, type Launch } from './child.js';
import { dataDirOf, readValues } from './daemon-files.js';
import { type InstallEntry } from './installation.js';
import { halt } from './gate.js';
import { laneOf, type Lane } from './lane.js';
import { type Limits } from './limits.js';
import { runInstaller } from './installer-call.js';
import { type PendingChanges } from './pending.js';
import { type Queue } from './queue.js';
import { crashed, healthyFor, reasonOf, resetRestarts, type Retry } from './restart.js';
import { assertSecrets, healthy, redact } from './start-checks.js';
import { type Stopping } from './stopping.js';

// Called on every boot for each entry with a version: idempotent (docs/part-image.md).
// signal: aborted when the daemon stops waiting (installMs); an installer may ignore it.
export interface InstallSpec {
  id: string;
  version?: string;
  signal?: AbortSignal;
}

export type Installer = (
  spec: InstallSpec
) => Promise<{ id: string; version: string; dir: string }>;

// C6: what list and /health print.
export type State = 'starting' | 'running' | 'failed' | 'disabled';

export interface Entry {
  id: string;
  install: InstallEntry;
  state: State;
  version: string;
  dir?: string;
  error?: string;
  lane?: Lane;
  // While a store extension swaps, its requests wait here: one process owns the data folder.
  gate?: Promise<void>;
  // C6: the exit times inside crashWindowMs, the restarts since a reset, the restart to come.
  exits?: number[];
  restarts?: number;
  retry?: Retry;
}

export interface Values {
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
}

// Where a change goes: the install entry, its values, and the folder a new version installed to.
export interface Next {
  install: InstallEntry;
  values: Values;
  dir?: string;
}

export interface SupervisorDeps extends Limits {
  configDir: string;
  launch: Launch;
  // The daemon's own origin: ctx.extension.origin of each child.
  origin: () => string;
  install?: Installer;
  log: Log;
  queue: Queue;
  pending: PendingChanges;
  stopping: Stopping;
  // The ids whose files a failed undo left unlike the list.
  unsynced: Set<string>;
}

export const valuesOf = async (configDir: string, id: string): Promise<Values> => ({
  settings: await readValues(configDir, 'settings', id),
  secrets: (await readValues(configDir, 'secrets', id)) as Record<string, string>,
});

// The package folder: the source itself, the folder an install gave, or the installer again.
const dirOf = async (deps: SupervisorDeps, entry: Entry, install: InstallEntry, given?: string) => {
  if (given) return given;
  if (install.source) return install.source;
  if (entry.dir && install.version === entry.install.version) return entry.dir;
  return (await runInstaller(deps, { id: entry.id, version: install.version })).dir;
};

// A new child for to, healthy, then the route; fresh: a start the owner asked for (restarts reset).
const launchFor = async (deps: SupervisorDeps, entry: Entry, to: Next, fresh: boolean) => {
  const dir = await dirOf(deps, entry, to.install, to.dir);
  const pkg = await readManifest(dir);
  assertSecrets(pkg, to.values.secrets);
  const spec = { id: entry.id, dir, dataDir: dataDirOf(deps.configDir, entry.id), ...to.values };
  const child = await deps
    .launch({ ...spec, origin: deps.origin(), storeOpenMs: deps.healthMs })
    .catch((err: Error) =>
      Promise.reject(Object.assign(err, { message: redact(err.message, to.values.secrets) }))
    );
  await healthy(child.port, deps.healthMs).catch(async (err: unknown) => {
    await child.stop();
    throw err;
  });
  const lane = laneOf(child);
  Object.assign(entry, { dir, version: pkg.version, lane, state: 'running', error: undefined });
  if (fresh) resetRestarts(entry);
  // Watched only once it is the route: an exit that came before this line is seen, not lost.
  const words = (how: Exit) => redact(reasonOf(how), to.values.secrets);
  void child.exited.then((how) => exitedEarly(deps, entry, lane, words(how)));
  healthyFor(deps, entry, lane);
};

// A child that exits while it is the route restarts (C6); a retired one was detached first.
const exitedEarly = (deps: SupervisorDeps, entry: Entry, lane: Lane, why: string): void => {
  if (entry.lane !== lane) return;
  entry.lane = undefined;
  crashed(deps, entry, why, () => restartEntry(deps, entry));
};

const failed = (deps: SupervisorDeps, entry: Entry, err: unknown): void => {
  Object.assign(entry, { state: 'failed', error: (err as Error).message });
  deps.log.warn('extension failed to start', { id: entry.id, reason: entry.error });
};

// The install and values of installation.json, as they are on disk; the error when it failed.
export const startEntry = async (
  deps: SupervisorDeps,
  entry: Entry,
  fresh = false
): Promise<Error | undefined> => {
  entry.state = 'starting';
  try {
    const values = await valuesOf(deps.configDir, entry.id);
    await launchFor(deps, entry, { install: entry.install, values }, fresh);
    return undefined;
  } catch (err) {
    failed(deps, entry, err);
    return err as Error;
  }
};

// A restart that does not start counts as one more exit.
const restartEntry = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  const err = await startEntry(deps, entry);
  if (err) crashed(deps, entry, err.message, () => restartEntry(deps, entry));
};

// The old install again after a refused change; a disabled one stays stopped.
const restore = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  if (entry.install.enabled === false) entry.state = 'disabled';
  else await startEntry(deps, entry);
};

// C6: the envelope of a refused start; reason is the child's own words.
export const startFailed = (entry: Entry, err: unknown) => {
  const reason = (err as Error).message;
  const details = { code: 'START_FAILED', reason };
  return fail('VALIDATION_ERROR', `${entry.id} failed to start: ${reason}`, { details });
};

// One writer per data folder (the caller holds the gate): stop the old child, start the new one.
export const swap = async (
  deps: SupervisorDeps,
  entry: Entry,
  to: Next,
  undo: () => Promise<unknown> = async () => undefined
) => {
  try {
    await halt(entry, deps.drainMs);
    await launchFor(deps, entry, to, true);
  } catch (err) {
    await undo();
    await restore(deps, entry);
    throw startFailed(entry, err);
  }
};
