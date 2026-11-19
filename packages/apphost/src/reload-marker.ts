import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Log } from '@agentage/extension/internal';
import { runDirOf } from './daemon-files.js';
import { type Entry } from './supervisor.js';

// D14 (revised): the child runs dist/; dist.next/ is the watcher's tree and stays; dist.prev/ is the last good.
const DIST = 'dist';
const NEXT = 'dist.next';
const PREV = 'dist.prev';

const markerOf = (configDir: string, id: string) => join(runDirOf(configDir, id), 'reload.json');

const gone = (path: string) => rm(path, { recursive: true, force: true });

// Written once a stale dist.prev is gone: marker and dist.prev together mean a swap not confirmed.
export const markReload = async (configDir: string, id: string, dir: string): Promise<void> => {
  await gone(join(dir, PREV));
  const marker = markerOf(configDir, id);
  await mkdir(join(marker, '..'), { recursive: true });
  await writeFile(
    marker,
    JSON.stringify({ id, dir, complete: false, at: new Date().toISOString() })
  );
};

export const unmarkReload = (configDir: string, id: string): Promise<void> =>
  gone(markerOf(configDir, id));

// dist to dist.prev, a copy of dist.next to dist; false when there is no new build (a plain restart).
export const swapIn = async (dir: string): Promise<boolean> => {
  if (!existsSync(join(dir, NEXT))) return false;
  if (existsSync(join(dir, DIST))) await rename(join(dir, DIST), join(dir, PREV));
  await cp(join(dir, NEXT), join(dir, DIST), { recursive: true });
  return true;
};

// The copied build goes, the last good one comes back; with no dist.prev, dist is never touched.
export const swapBack = async (dir: string): Promise<void> => {
  if (!existsSync(join(dir, PREV))) return;
  await gone(join(dir, DIST));
  await rename(join(dir, PREV), join(dir, DIST));
};

// The new build is healthy: the marker first, then the old build.
export const confirmReload = async (configDir: string, id: string, dir: string) => {
  await unmarkReload(configDir, id);
  await gone(join(dir, PREV));
};

const markedDir = async (configDir: string, id: string): Promise<unknown> => {
  const text = await readFile(markerOf(configDir, id), 'utf8');
  return (JSON.parse(text) as { dir?: unknown }).dir;
};

// At boot: a marker of this row's folder with a dist.prev is a cut reload, put back to the last good build.
export const repairReload = async (configDir: string, entry: Entry, log: Log): Promise<void> => {
  const dir = entry.install.source;
  if (!dir || !existsSync(markerOf(configDir, entry.id))) return;
  const ours = (await markedDir(configDir, entry.id).catch(() => undefined)) === dir;
  if (ours && existsSync(join(dir, PREV))) {
    await swapBack(dir);
    log.warn('a cut reload was put back to the last good build', { id: entry.id });
  }
  await unmarkReload(configDir, entry.id);
};
