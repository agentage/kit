// SPIKE s113-l0, not for merge: POST /host/extensions/{id}/reload for a folder row.
// The new build is in {source}/dist.next; it becomes dist only once its child is healthy.
import { access, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '../../envelope/envelope.js';
import { entryOf, summary, type Entries } from './entries.js';
import { halt, hold, startEntry, type SupervisorDeps } from './supervisor.js';

export interface Marks {
  [k: string]: number;
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false
  );

const swapIn = async (dir: string) => {
  await rm(join(dir, 'dist.prev'), { recursive: true, force: true });
  await rename(join(dir, 'dist'), join(dir, 'dist.prev'));
  await rename(join(dir, 'dist.next'), join(dir, 'dist'));
};

// The failed build goes aside as dist.bad; the last good one is dist again.
const swapBack = async (dir: string) => {
  await rm(join(dir, 'dist.bad'), { recursive: true, force: true });
  await rename(join(dir, 'dist'), join(dir, 'dist.bad'));
  await rename(join(dir, 'dist.prev'), join(dir, 'dist'));
};

// The two-folder variant: stop, swap dist.next in, start; unhealthy = swap back and start again.
export const reloadExtension = async (deps: SupervisorDeps, entries: Entries, id: string) => {
  const entry = entryOf(entries, id);
  const dir = entry.install.source;
  if (!dir) throw fail('VALIDATION_ERROR', `${id} is not a folder row`);
  const marks: Marks = { received: Date.now() };
  const release = hold(entry);
  let restored: string | undefined;
  try {
    const next = await exists(join(dir, 'dist.next'));
    marks['haltStart'] = Date.now();
    await halt(entry, deps.drainMs);
    marks['haltEnd'] = Date.now();
    if (next) await swapIn(dir);
    marks['swapEnd'] = Date.now();
    await startEntry(deps, entry);
    marks['startEnd'] = Date.now();
    if (entry.state !== 'running' && next) {
      restored = entry.error;
      await halt(entry, deps.drainMs);
      await swapBack(dir);
      await startEntry(deps, entry);
      marks['restoreEnd'] = Date.now();
    }
  } finally {
    release();
  }
  return { ...summary(entry), reloaded: !restored, ...(restored && { refused: restored }), marks };
};
