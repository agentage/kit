import { type HealthCheck } from '../health/health.js';
import { messageOf, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { storeOf } from '../manifest/parts.js';
import { createClickhouseStore } from '../store/clickhouse-store.js';
import { migrate } from '../store/migrations.js';
import { createStore, MIGRATE_TIMEOUTS, storeCheck, type PoolStore } from '../store/store.js';
import {
  isUrlStoreKind,
  readStoreUrl,
  STORE_URL_FILE_ENV,
  type UrlStoreKind,
} from '../store/store-url.js';
import { type Store } from '../store/store.types.js';

// The host's store, whichever opened it: queries, and a close on stop.
export interface HostStore extends Store {
  close(): Promise<void>;
  // Set for a store opened from a URL: /health then also names the kind (checks["store:postgres"]).
  readonly kind?: UrlStoreKind;
}

export interface UrlStoreAt {
  dir: string;
  // AGENTAGE_STORE_URL_FILE: the estate's secret file with the store's URL.
  file?: string;
  openMs: number;
}

type Pool = (url: string, log: Log, timeouts?: typeof MIGRATE_TIMEOUTS) => PoolStore;
const poolOf: Pool = (url, log, timeouts) =>
  createStore({ AGENTAGE_STORE_URL: url }, log, timeouts);

// Migrations on their own short-lived pool with the migrate job's limits, not the part's 10 s.
const migrateOn = async (url: string, dir: string, log: Log, pool: Pool) => {
  const own = pool(url, log, MIGRATE_TIMEOUTS);
  try {
    await migrate(own, dir, log);
  } finally {
    await own.end();
  }
};

// Every query waits on the migrations; a failed run is not kept, so the next use (and /health) retries.
export const preparedPostgres = (url: string, dir: string, log: Log, pool = poolOf): HostStore => {
  const parts = pool(url, log);
  let ready: Promise<void> | undefined;
  const prepared = () =>
    (ready ??= migrateOn(url, dir, log, pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    }));
  return {
    kind: 'postgres',
    query: async (text, params) => (await prepared(), parts.query(text, params)),
    close: () => parts.end(),
  };
};

const within = <T>(work: Promise<T>, ms: number): Promise<T | 'late'> =>
  Promise.race([work, new Promise<'late'>((ok) => setTimeout(() => ok('late'), ms).unref())]);

// The start waits up to openMs for the store; one that is down still starts, /health says 503.
const firstUse = async (store: HostStore, kind: UrlStoreKind, openMs: number, log: Log) => {
  const opened = store.query('select 1').then(
    () => 'ok' as const,
    (err: unknown) => err
  );
  const result = await within(opened, openMs);
  if (result === 'ok') return log.info('store opened', { kind, from: STORE_URL_FILE_ENV });
  const reason = result === 'late' ? `not in ${openMs} ms` : messageOf(result);
  log.warn('the store did not open: /health says unavailable until it does', { kind, reason });
};

const kindOf = (pkg: ExtensionPackage, log: Log): UrlStoreKind | undefined => {
  const kind = storeOf(pkg);
  if (isUrlStoreKind(kind)) return kind;
  log.warn(`${STORE_URL_FILE_ENV} is set, the package has no postgres or clickhouse store: unused`);
  return undefined;
};

// G1, G2: the estate's store from AGENTAGE_STORE_URL_FILE; unset, the host keeps PGlite (undefined).
export const openUrlStore = async (
  pkg: ExtensionPackage,
  at: UrlStoreAt,
  log: Log
): Promise<HostStore | undefined> => {
  if (!at.file) return undefined;
  const kind = kindOf(pkg, log);
  if (!kind) return undefined;
  const url = await readStoreUrl(at.file, kind);
  const store =
    kind === 'postgres' ? preparedPostgres(url, at.dir, log) : createClickhouseStore(url, log);
  await firstUse(store, kind, at.openMs, log);
  return store;
};

// checks.store as before, plus checks["store:<kind>"] for a URL store: one probe answers both.
export const hostStoreChecks = (store: HostStore | undefined): Record<string, HealthCheck> => {
  if (!store) return {};
  const check = storeCheck(store);
  return { store: check, ...(store.kind && { [`store:${store.kind}`]: check }) };
};
