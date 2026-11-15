import { mkdir } from 'node:fs/promises';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore } from '../manifest/parts.js';
import { migrate } from '../store/migrations.js';
import { createPgliteStore, type PgliteStore } from '../store/pglite-store.js';
import { lockDataDir } from './data-lock.js';

const unlocked = async () => undefined;

// Locks dataDir, then opens PGlite in it and migrates before the part starts.
const open = async (dir: string, dataDir: string, log: Log): Promise<PgliteStore> => {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const release = dataDir ? await lockDataDir(dataDir) : unlocked;
  const store = createPgliteStore((s) => migrate(s, dir, log), {
    dataDir: dataDir || undefined,
    from: dir,
  });
  const close = async () => {
    await store.close().catch(() => undefined);
    await release();
  };
  await store.query('select 1').catch(async (err: unknown) => {
    await close();
    throw err;
  });
  return { query: store.query, close };
};

// A postgres store as PGlite with its files in dataDir; none set keeps it in memory.
export const openHostStore = async (
  dir: string,
  pkg: ExtensionPackage,
  dataDir: string,
  log: Log
): Promise<PgliteStore | undefined> => {
  if (!hasStore(pkg, 'postgres')) return undefined;
  if (!dataDir) log.warn('no data folder: the store is in memory and lost on exit');
  return open(dir, dataDir, log);
};
