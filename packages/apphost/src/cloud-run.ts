import { dirname } from 'node:path';
import { type Log } from '@agentage/extension/internal';
import { type CloudDiscovery } from './cloud-discovery.js';
import { type CloudFiles } from './cloud-files.js';
import { type Entries } from './entries.js';
import { halt } from './gate.js';
import { LIMITS } from './limits.js';
import { pendingChanges } from './pending.js';
import { serialQueue } from './queue.js';
import { stoppingOf } from './stopping.js';
import { startEntry, type SupervisorDeps } from './supervisor.js';
import { upstreamRunner } from './upstream-runner.js';

// The rows of installation.json as supervisor entries: entry.state is the run (connected or not),
// never whether the extension serves; that is the discovery state.
export const entriesOf = ({ installation }: CloudFiles): Entries =>
  new Map(
    installation.extensions.map((row) => {
      const state = row.enabled === false ? ('disabled' as const) : ('starting' as const);
      return [row.id, { id: row.id, install: row, state, version: row.version }];
    })
  );

export interface CloudRunOptions {
  files: CloudFiles;
  installationFile: string;
  own: string;
  log: Log;
  discovery: CloudDiscovery;
}

// The one seam of J.4.3: the supervisor runs each extension through the upstream runner (#163).
// The mount holds no settings or secrets file, so each entry starts with none.
const depsOf = (o: CloudRunOptions, life: AbortController): SupervisorDeps => ({
  ...LIMITS,
  configDir: dirname(o.installationFile),
  runner: upstreamRunner({ upstreams: o.files.upstreams, stateOf: o.discovery.stateOf }),
  origin: () => o.own,
  log: o.log,
  queue: serialQueue(),
  pending: pendingChanges(),
  stopping: stoppingOf(life.signal),
  unsynced: new Set(),
  user: {},
});

// Each enabled entry started through the supervisor; stop retires every run.
export const startRuns = async (o: CloudRunOptions, entries: Entries) => {
  const life = new AbortController();
  const deps = depsOf(o, life);
  for (const entry of entries.values())
    if (entry.state !== 'disabled') await startEntry(deps, entry);
  return async () => {
    life.abort();
    await Promise.all([...entries.values()].map((entry) => halt(entry, deps.drainMs)));
  };
};
