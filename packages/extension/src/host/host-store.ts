import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore } from '../manifest/parts.js';
import { migrate } from '../store/migrations.js';
import { createPgliteStore, type PgliteStore } from '../store/pglite-store.js';
import { DATA_DIR_LOCKED, lockDataDir } from './data-lock.js';

const unlocked = async () => undefined;

// How long the host waits for the store to open (and to close); the daemon sets its healthMs.
export const STORE_OPEN_MS = 120_000;

const within = <T>(work: Promise<T>, ms: number): Promise<T | 'late'> =>
  Promise.race([
    work,
    new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), ms).unref()),
  ]);

const LOCK_RETRY_MS = 100;

// A holder that is still draining (an old child, an orphan) lets go soon: retry until openMs.
export const lockWithin = async (dataDir: string, openMs: number): Promise<() => Promise<void>> => {
  const until = Date.now() + openMs;
  for (;;) {
    try {
      return await lockDataDir(dataDir);
    } catch (err) {
      if ((err as { code?: unknown }).code !== DATA_DIR_LOCKED || Date.now() >= until) throw err;
      await sleep(LOCK_RETRY_MS);
    }
  }
};

// A close past openMs keeps the data lock: PGlite may still write there until the process exits.
const closer = (store: PgliteStore, release: () => Promise<void>, openMs: number) => async () => {
  const closed = await within(
    store.close().catch(() => undefined),
    openMs
  );
  if (closed !== 'late') await release();
};

// Locks dataDir, then opens PGlite in it and migrates; past openMs the part starts, /health says not ready.
const open = async (at: StoreAt, log: Log): Promise<PgliteStore> => {
  const { dir, dataDir, openMs } = at;
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const release = dataDir ? await lockWithin(dataDir, openMs) : unlocked;
  const store = createPgliteStore((s) => migrate(s, dir, log), {
    dataDir: dataDir || undefined,
    from: dir,
  });
  const close = closer(store, release, openMs);
  const opened = store.query('select 1').catch(async (err: unknown) => {
    await close();
    throw err;
  });
  if ((await within(opened, openMs)) === 'late') {
    opened.catch(() => undefined);
    log.warn('the store did not open in time: /health says unavailable until it does', { openMs });
  }
  return { query: store.query, close };
};

interface StoreAt {
  dir: string;
  dataDir: string;
  openMs: number;
}

// A postgres store as PGlite with its files in dataDir; none set keeps it in memory.
export const openHostStore = async (
  pkg: ExtensionPackage,
  at: StoreAt,
  log: Log
): Promise<PgliteStore | undefined> => {
  if (!hasStore(pkg, 'postgres')) return undefined;
  if (!at.dataDir) log.warn('no data folder: the store is in memory and lost on exit');
  return open(at, log);
};
