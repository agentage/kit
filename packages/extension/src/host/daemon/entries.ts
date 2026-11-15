import { fail } from '../../envelope/envelope.js';
import { persistInstallation, withEntry, type InstallEntry } from './installation.js';
import { type Entry, type SupervisorDeps } from './supervisor.js';

export type Entries = Map<string, Entry>;

// pid of a running child: the e2e teardown reads it.
export const summary = ({ id, version, state, error, lane }: Entry) => ({
  id,
  version,
  state,
  ...(lane && { pid: lane.child.pid }),
  ...(error && { error }),
});

export const listed = (entry: Entry) => ({
  ...summary(entry),
  source: entry.install.source ?? 'market',
  enabled: entry.install.enabled !== false,
});

export const entryOf = (entries: Entries, id: string): Entry => {
  const entry = entries.get(id);
  if (!entry) throw fail('NOT_FOUND', `${id} is not installed`);
  return entry;
};

// The entry of id in installation.json replaced, added, or (no install) removed.
export const persist = (deps: SupervisorDeps, id: string, install?: InstallEntry) =>
  persistInstallation(deps.configDir, (doc) => withEntry(doc, id, install), deps.lockMs);
