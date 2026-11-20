import { dirname } from 'node:path';
import { type Log } from '@agentage/extension/internal';
import { type CloudDiscovery } from './cloud-discovery.js';
import { type CloudFiles } from './cloud-files.js';
import { type CloudRows } from './cloud-installation.js';
import { type Entries } from './entries.js';
import { halt } from './gate.js';
import { LIMITS } from './limits.js';
import { pendingChanges } from './pending.js';
import { serialQueue } from './queue.js';
import { stoppingOf } from './stopping.js';
import { startEntry, type SupervisorDeps } from './supervisor.js';
import { upstreamRunner } from './upstream-runner.js';

// The rows of installation.json as supervisor entries: entry.state is the run (connected or not),
// never whether the extension serves; that is the discovery state. No row is disabled in the cloud.
export const entriesOf = ({
  installation,
}: {
  installation: Pick<CloudRows, 'extensions'>;
}): Entries =>
  new Map(
    installation.extensions.map((row) => [
      row.id,
      { id: row.id, install: row, state: 'starting' as const, version: row.version },
    ])
  );

export interface CloudRunOptions {
  files: Pick<CloudFiles, 'upstreams'>;
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
