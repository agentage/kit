import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Log } from '../../log/log.js';
import { type Entry } from './supervisor.js';

// D14: the build a child runs is dist/; the next one waits in dist.next/, the last good in dist.prev/.
const DIST = 'dist';
const NEXT = 'dist.next';
const PREV = 'dist.prev';

const markerOf = (configDir: string, id: string) => join(configDir, 'run', id, 'reload.json');

const gone = (path: string) => rm(path, { recursive: true, force: true });

// Written once a stale dist.prev is gone: marker and dist.prev together mean a swap not confirmed.
export const markReload = async (configDir: string, id: string, dir: string): Promise<void> => {
  await gone(join(dir, PREV));
  const marker = markerOf(configDir, id);
  await mkdir(join(marker, '..'), { recursive: true });
  await writeFile(marker, JSON.stringify({ id, dir, at: new Date().toISOString() }));
};

export const unmarkReload = (configDir: string, id: string): Promise<void> =>
  gone(markerOf(configDir, id));

// dist to dist.prev, dist.next to dist; false when there is no new build (a plain restart).
export const swapIn = async (dir: string): Promise<boolean> => {
  if (!existsSync(join(dir, NEXT))) return false;
  if (existsSync(join(dir, DIST))) await rename(join(dir, DIST), join(dir, PREV));
  await rename(join(dir, NEXT), join(dir, DIST));
  return true;
};

// The refused build goes back to dist.next (the cli builds over it), the last good one to dist.
export const swapBack = async (dir: string): Promise<void> => {
  if (!existsSync(join(dir, PREV))) return;
  if (existsSync(join(dir, DIST))) {
    await gone(join(dir, NEXT));
    await rename(join(dir, DIST), join(dir, NEXT));
  }
  await rename(join(dir, PREV), join(dir, DIST));
};

// The new build is healthy: the marker first, then the old build.
export const confirmReload = async (configDir: string, id: string, dir: string) => {
  await unmarkReload(configDir, id);
  await gone(join(dir, PREV));
};

// At boot: a reload that a stop or crash cut goes back to the last good build of that folder row.
export const repairReload = async (configDir: string, entry: Entry, log: Log): Promise<void> => {
  const dir = entry.install.source;
  if (!dir) return;
  if (!existsSync(markerOf(configDir, entry.id))) return;
  await swapBack(dir);
  await unmarkReload(configDir, entry.id);
  log.warn('a cut reload was put back to the last good build', { id: entry.id });
};
