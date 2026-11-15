import { mkdir } from 'node:fs/promises';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore } from '../manifest/parts.js';
import { migrate } from '../store/migrations.js';
import { createTestStore, type TestStore } from '../store/test-store.js';

// A postgres store as PGlite with its files in dataDir, migrated before the part starts.
export const openHostStore = async (
  dir: string,
  pkg: ExtensionPackage,
  dataDir: string,
  log: Log
): Promise<TestStore | undefined> => {
  if (!hasStore(pkg, 'postgres')) return undefined;
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const store = createTestStore((s) => migrate(s, dir, log), {
    dataDir: dataDir || undefined,
    from: dir,
  });
  try {
    await store.query('select 1');
  } catch (err) {
    await store.close().catch(() => undefined);
    throw err;
  }
  return store;
};
