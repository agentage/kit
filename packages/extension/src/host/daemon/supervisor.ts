import { fail } from '../../envelope/envelope.js';
import { type Log } from '../../log/log.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Exit, type Launch } from './child.js';
import { dataDirOf, readValues } from './daemon-files.js';
import { type InstallEntry } from './installation.js';
import { laneOf, retire, type Lane } from './lane.js';
import { runInstaller } from './installer-call.js';

import { type Queue } from './queue.js';

export const GATE_MS = 30_000;

// Called again on every boot for each entry with a version, one entry at a time: it must be
// idempotent and fast for a version that is installed. An error with a string code (and status
// 400, 404 or 502) reaches the client as the envelope with that code and message; others are a 500.
export type Installer = (spec: {
  id: string;
  version?: string;
}) => Promise<{ id: string; version: string; dir: string }>;

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

export interface SupervisorDeps {
  configDir: string;
  launch: Launch;
  // The daemon's own origin: ctx.extension.origin of each child.
  origin: () => string;
  install?: Installer;
  log: Log;
  // The open requests of an old child get drainMs; a new child answers /health within healthMs.
  drainMs: number;
  healthMs: number;
  queue: Queue;
}

export const DRAIN_MS = 10_000;
export const HEALTH_MS = 60_000;

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

// Healthy before it gets the route: the child's own /health answers 200.
const healthy = async (port: number, ms: number): Promise<void> => {
  const signal = AbortSignal.timeout(ms);
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal }).catch(() => {
    throw new Error(`health did not answer in ${ms} ms`);
  });
  if (res.status !== 200) throw new Error(`health answered ${res.status}`);
};

// A new child for install with values, healthy; the entry learns the version the package has.
export const launchFor = async (
  deps: SupervisorDeps,
  entry: Entry,
  install: InstallEntry,
  values: Values,
  given?: string
): Promise<Lane> => {
  const dir = await dirOf(deps, entry, install, given);
  const pkg = await readManifest(dir);
  const spec = { id: entry.id, dir, dataDir: dataDirOf(deps.configDir, entry.id), ...values };
  const child = await deps.launch({ ...spec, origin: deps.origin() });
  await healthy(child.port, deps.healthMs).catch(async (err: unknown) => {
    await child.stop();
    throw err;
  });
  Object.assign(entry, { dir, version: pkg.version });
  const lane = laneOf(child, pkg.version);
  void child.exited.then((how) => exitedEarly(deps, entry, lane, how));
  return lane;
};

// A child that exits while it is the route is failed; a retired one was detached first.
const exitedEarly = (deps: SupervisorDeps, entry: Entry, lane: Lane, how: Exit): void => {
  if (entry.lane !== lane) return;
  const why = how.signal ? `signal ${how.signal}` : `code ${how.code}`;
  Object.assign(entry, { lane: undefined, state: 'failed', error: `the process exited (${why})` });
  deps.log.warn('extension process exited', { id: entry.id });
};

const failed = (deps: SupervisorDeps, entry: Entry, err: unknown): void => {
  Object.assign(entry, { state: 'failed', error: (err as Error).message });
  deps.log.warn('extension failed to start', { id: entry.id, reason: entry.error });
};

// The install and values of installation.json, as they are on disk.
export const startEntry = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  entry.state = 'starting';
  try {
    const values = await valuesOf(deps.configDir, entry.id);
    entry.lane = await launchFor(deps, entry, entry.install, values);
    Object.assign(entry, { state: 'running', error: undefined });
  } catch (err) {
    failed(deps, entry, err);
  }
};

// New requests of the extension wait here (the proxy gives up after GATE_MS) until release.
const hold = (entry: Entry): (() => void) => {
  let release = () => undefined as void;
  entry.gate = new Promise<void>((resolve) => (release = resolve));
  return () => {
    entry.gate = undefined;
    release();
  };
};

// The old install again after a refused change; a disabled one stays stopped.
const restore = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  if (entry.install.enabled === false) entry.state = 'disabled';
  else await startEntry(deps, entry);
};

export const startFailed = (entry: Entry, err: unknown) =>
  fail(
    'VALIDATION_ERROR',
    `${entry.id} failed to start with this change: ${(err as Error).message}`,
    {
      code: 'START_FAILED',
    }
  );

// One writer per data folder, so one sequence for every extension, running or not: hold, drain
// and stop the old child, start the new one, release. A refusal restores the old one and is a 400.
export const swap = async (deps: SupervisorDeps, entry: Entry, to: Next) => {
  const release = hold(entry);
  try {
    await halt(entry, deps.drainMs);
    entry.lane = await launchFor(deps, entry, to.install, to.values, to.dir);
    Object.assign(entry, { state: 'running', error: undefined });
  } catch (err) {
    await restore(deps, entry);
    throw startFailed(entry, err);
  } finally {
    release();
  }
};

// Detached first, so its exit is not a failure; then drained and stopped.
export const halt = async (entry: Entry, drainMs: number): Promise<void> => {
  const lane = entry.lane;
  entry.lane = undefined;
  await retire(lane, drainMs);
};
