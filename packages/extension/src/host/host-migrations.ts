import { join } from 'node:path';
import { type HealthCheck } from '../health/health.js';
import { createLog, type Log } from '../log/log.js';
import { storeOf } from '../manifest/parts.js';
import { readManifest } from '../manifest/read-manifest.js';
import { type Env } from '../runtime/build-info.js';
import { KIT_MIGRATIONS } from '../store/kit-migrations.js';
import { migrate, sqlFiles, type MigrateResult } from '../store/migrations.js';
import { createStore, MIGRATE_TIMEOUTS } from '../store/store.js';
import { readStoreUrl, STORE_URL_FILE_ENV } from '../store/store-url.js';
import { type Store } from '../store/store.types.js';

const UNDEFINED_TABLE = '42P01';

// The kit's and the package's migration names the ledger does not hold yet.
export const pendingMigrations = async (store: Store, dir: string): Promise<string[]> => {
  const want = [...KIT_MIGRATIONS.map((m) => m.name), ...(await sqlFiles(join(dir, 'migrations')))];
  try {
    const { rows } = await store.query<{ name: string }>('select name from _migrations');
    const done = new Set(rows.map((row) => row.name));
    return want.filter((name) => !done.has(name));
  } catch (err) {
    if ((err as { code?: unknown }).code === UNDEFINED_TABLE) return want;
    throw err;
  }
};

// checks["store:migrations"]: the serving host never migrates; ok once, it stays ok (one image, one set).
export const migrationsCheck = (store: Store, dir: string, log: Log): HealthCheck => {
  let applied = false;
  let warned = false;
  return async () => {
    if (applied) return 'ok';
    const pending = await pendingMigrations(store, dir);
    applied = pending.length === 0;
    if (!applied && !warned)
      log.warn('migrations not applied: run the migrate job', { pending: pending.join(', ') });
    warned ||= !applied;
    return applied ? 'ok' : 'unavailable';
  };
};

// `main.js migrate`: the one container as a one-shot job; the URL is never printed.
export const migrateHost = async (
  env: Env,
  write = (line: string) => void process.stdout.write(line)
): Promise<MigrateResult | undefined> => {
  const dir = env['AGENTAGE_EXTENSION_DIR'] || process.cwd();
  const pkg = await readManifest(dir);
  const log = createLog({ extension: pkg.agentage.id, part: 'migrate', version: pkg.version });
  const file = env[STORE_URL_FILE_ENV];
  if (!file) throw new Error(`migrate needs ${STORE_URL_FILE_ENV}`);
  if (storeOf(pkg) !== 'postgres') return void log.info('no postgres store: nothing to migrate');
  const url = await readStoreUrl(file, 'postgres');
  const store = createStore({ AGENTAGE_STORE_URL: url }, log, MIGRATE_TIMEOUTS);
  try {
    const result = await migrate(store, dir, log);
    write(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    await store.end();
  }
};
