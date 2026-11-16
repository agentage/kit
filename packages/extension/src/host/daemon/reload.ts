import { z } from 'zod';
import { fail } from '../../envelope/envelope.js';
import { parse } from '../../envelope/parse.js';
import { entryOf, type Entries } from './entries.js';
import { confirmReload, markReload, swapBack, swapIn, unmarkReload } from './reload-marker.js';
import { resetRestarts } from './restart.js';
import { halt, hold, startEntry, type Entry, type SupervisorDeps } from './supervisor.js';

const ReloadSchema = z.strictObject({});

// Only a linked working copy has a build to reload; a disabled one stays stopped.
const folderOf = (entry: Entry): string => {
  const dir = entry.install.source;
  if (!dir)
    throw fail('VALIDATION_ERROR', `${entry.id} is not a folder: only a linked folder reloads`);
  if (entry.install.enabled === false)
    throw fail('CONFLICT', `${entry.id} is disabled: enable it first`);
  return dir;
};

const answer = (entry: Entry, refused?: string) => ({
  id: entry.id,
  version: entry.version,
  state: entry.state,
  ...(entry.lane && { pid: entry.lane.child.pid }),
  reloaded: refused === undefined,
  ...(refused !== undefined && { refused }),
});

// Not healthy: the new build goes back aside and the last good build starts again.
const restoreLast = async (deps: SupervisorDeps, entry: Entry, dir: string, swapped: boolean) => {
  if (swapped) await swapBack(dir);
  await unmarkReload(deps.configDir, entry.id);
  if (swapped) await startEntry(deps, entry);
};

const tryNew = async (deps: SupervisorDeps, entry: Entry, dir: string) => {
  await markReload(deps.configDir, entry.id, dir);
  const swapped = await swapIn(dir);
  const err = await startEntry(deps, entry);
  if (!err) {
    await confirmReload(deps.configDir, entry.id, dir);
    resetRestarts(entry);
    return answer(entry);
  }
  await restoreLast(deps, entry, dir, swapped);
  return answer(entry, err.message.split('\n')[0]);
};

// D14: stop and wait for the exit (one writer on the store), swap the builds, start, wait healthy.
const reloadIn = async (deps: SupervisorDeps, entry: Entry, dir: string) => {
  await halt(entry, deps.drainMs);
  try {
    return await tryNew(deps, entry, dir);
  } catch (err) {
    // A file step failed: the last good build runs again, the caller gets the error.
    await restoreLast(deps, entry, dir, true);
    throw err;
  }
};

// POST /host/extensions/{id}/reload, body {}: requests wait at the gate and go to the new child.
export const reloadExtension = async (
  deps: SupervisorDeps,
  entries: Entries,
  id: string,
  body: unknown
) => {
  parse(ReloadSchema, body ?? {}, 'Invalid body');
  const entry = entryOf(entries, id);
  const dir = folderOf(entry);
  const release = hold(entry);
  try {
    return await reloadIn(deps, entry, dir);
  } finally {
    release();
  }
};
