import { fail } from '../../envelope/envelope.js';
import { type Log } from '../../log/log.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Launch } from './child.js';
import { dataDirOf, readValues } from './daemon-files.js';
import { type InstallEntry } from './installation.js';
import { laneOf, retire, type Lane } from './lane.js';

export const GATE_MS = 30_000;

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
}

export const NO_INSTALLER = 'this daemon has no installer: install a folder with { source }';

// 501 as C5 says, in the envelope; the closed code set has no NOT_IMPLEMENTED.
export const noInstaller = () =>
  Object.assign(fail('UNAVAILABLE', NO_INSTALLER), { status: 501, retryAfter: undefined });

export const valuesOf = async (configDir: string, id: string): Promise<Values> => ({
  settings: await readValues(configDir, 'settings', id),
  secrets: (await readValues(configDir, 'secrets', id)) as Record<string, string>,
});

// The package folder: the source itself, the folder an install gave, or the installer again.
const dirOf = async (deps: SupervisorDeps, entry: Entry, install: InstallEntry, given?: string) => {
  if (given) return given;
  if (install.source) return install.source;
  if (entry.dir && install.version === entry.install.version) return entry.dir;
  if (!deps.install) throw noInstaller();
  return (await deps.install({ id: entry.id, version: install.version })).dir;
};

// Healthy before it gets the route: the child's own /health answers 200.
const healthy = async (port: number): Promise<void> => {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
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
  await healthy(child.port).catch(async (err: unknown) => {
    await child.stop();
    throw err;
  });
  Object.assign(entry, { dir, version: pkg.version });
  const lane = laneOf(child, pkg.version);
  void child.exited.then(() => exitedEarly(deps, entry, lane));
  return lane;
};

// A child that exits while it is the route is failed; a retired one was detached first.
const exitedEarly = (deps: SupervisorDeps, entry: Entry, lane: Lane): void => {
  if (entry.lane !== lane) return;
  Object.assign(entry, { lane: undefined, state: 'failed', error: 'the process exited' });
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

// One writer per data folder, so one sequence for every extension: hold, drain and stop the
// old child, start the new one, release. A refusal starts the old one again and is a 400.
export const swap = async (deps: SupervisorDeps, entry: Entry, to: Next) => {
  const release = hold(entry);
  try {
    await halt(entry);
    entry.lane = await launchFor(deps, entry, to.install, to.values, to.dir);
    Object.assign(entry, { state: 'running', error: undefined });
  } catch (err) {
    await startEntry(deps, entry);
    const reason = (err as Error).message;
    throw fail('VALIDATION_ERROR', `${entry.id} failed to start with this change: ${reason}`, {
      code: 'START_FAILED',
    });
  } finally {
    release();
  }
};

// Detached first, so its exit is not a failure; then drained and stopped.
export const halt = async (entry: Entry): Promise<void> => {
  const lane = entry.lane;
  entry.lane = undefined;
  await retire(lane);
};
