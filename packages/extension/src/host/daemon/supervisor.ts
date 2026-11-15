import { fail } from '../../envelope/envelope.js';
import { type Log } from '../../log/log.js';
import { hasStore } from '../../manifest/parts.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Launch } from './child.js';
import { dataDirOf, readValues } from './daemon-files.js';
import { type InstallEntry } from './installation.js';
import { laneOf, retire, type Lane } from './lane.js';

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
  store: boolean;
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

export interface SupervisorDeps {
  configDir: string;
  launch: Launch;
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
const dirOf = async (deps: SupervisorDeps, entry: Entry, install: InstallEntry) => {
  if (install.source) return install.source;
  if (entry.dir && install.version === entry.install.version) return entry.dir;
  if (!deps.install) throw noInstaller();
  return (await deps.install({ id: entry.id, version: install.version })).dir;
};

// A new child for install with values; the entry learns the version the package has.
export const launchFor = async (
  deps: SupervisorDeps,
  entry: Entry,
  install: InstallEntry,
  values: Values
): Promise<Lane> => {
  const dir = await dirOf(deps, entry, install);
  const pkg = await readManifest(dir);
  const dataDir = dataDirOf(deps.configDir, entry.id);
  const child = await deps.launch({ id: entry.id, dir, dataDir, ...values });
  Object.assign(entry, { dir, version: pkg.version, store: hasStore(pkg, 'postgres') });
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

export const startEntry = async (deps: SupervisorDeps, entry: Entry): Promise<void> => {
  entry.state = 'starting';
  try {
    const values = await valuesOf(deps.configDir, entry.id);
    entry.lane = await launchFor(deps, entry, entry.install, values);
    Object.assign(entry, { state: 'running', error: undefined });
  } catch (err) {
    Object.assign(entry, { state: 'failed', error: (err as Error).message });
    deps.log.warn('extension failed to start', { id: entry.id, reason: entry.error });
  }
};

// No store: start the new child, move the route, then drain and stop the old one.
const overlap = async (deps: SupervisorDeps, entry: Entry, install: InstallEntry, v: Values) => {
  const next = await launchFor(deps, entry, install, v);
  const old = entry.lane;
  entry.lane = next;
  await retire(old);
};

// A store: hold new requests, drain and stop the old child, start the new one (or the old again).
const handOver = async (deps: SupervisorDeps, entry: Entry, install: InstallEntry, v: Values) => {
  let release = () => undefined as void;
  entry.gate = new Promise<void>((resolve) => (release = resolve));
  const old = entry.lane;
  entry.lane = undefined;
  try {
    await retire(old);
    entry.lane = await launchFor(deps, entry, install, v).catch(async (err: unknown) => {
      entry.lane = await launchFor(
        deps,
        entry,
        entry.install,
        await valuesOf(deps.configDir, entry.id)
      );
      throw err;
    });
  } finally {
    entry.gate = undefined;
    release();
  }
};

// A running extension moves to install with values; on a refusal the old child keeps the route.
export const swap = async (
  deps: SupervisorDeps,
  entry: Entry,
  install: InstallEntry,
  v: Values
) => {
  try {
    await (entry.store ? handOver : overlap)(deps, entry, install, v);
  } catch (err) {
    const reason = (err as Error).message;
    if (!entry.lane) Object.assign(entry, { state: 'failed', error: reason });
    throw fail('VALIDATION_ERROR', `${entry.id} did not start with this change: ${reason}`);
  }
  Object.assign(entry, { state: 'running', error: undefined });
};

// Detached first, so its exit is not a failure; then drained and stopped.
export const halt = async (entry: Entry): Promise<void> => {
  const lane = entry.lane;
  entry.lane = undefined;
  await retire(lane);
};
