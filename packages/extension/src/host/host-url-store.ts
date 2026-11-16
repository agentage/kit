import { type HealthCheck } from '../health/health.js';
import { messageOf, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { storeOf } from '../manifest/parts.js';
import { createClickhouseStore } from '../store/clickhouse-store.js';
import { createStore, storeCheck, type PoolStore } from '../store/store.js';
import {
  isUrlStoreKind,
  readStoreUrl,
  STORE_URL_FILE_ENV,
  type UrlStoreKind,
} from '../store/store-url.js';
import { type Store } from '../store/store.types.js';
import { migrationsCheck } from './host-migrations.js';

// The host's store, whichever opened it: queries, and a close on stop.
export interface HostStore extends Store {
  close(): Promise<void>;
  // Set for a store opened from a URL (or git): /health then also names the kind (checks["store:git"]).
  readonly kind?: UrlStoreKind | 'git';
  // checks.store in place of a select 1 (git: the root is writable).
  readonly probe?: HealthCheck;
  // The store's own /health checks (store:migrations for postgres).
  readonly checks?: Record<string, HealthCheck>;
}

export interface UrlStoreAt {
  dir: string;
  // AGENTAGE_STORE_URL_FILE: the estate's secret file with the store's URL.
  file?: string;
  openMs: number;
}

type Pool = (url: string, log: Log) => PoolStore;
const poolOf: Pool = (url, log) => createStore({ AGENTAGE_STORE_URL: url }, log);

// The serving host never migrates (the migrate job does): /health is 503 until the ledger is current.
export const postgresStore = (url: string, dir: string, log: Log, pool = poolOf): HostStore => {
  const parts = pool(url, log);
  return {
    kind: 'postgres',
    query: parts.query,
    close: () => parts.end(),
    checks: { 'store:migrations': migrationsCheck(parts, dir, log) },
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
    kind === 'postgres' ? postgresStore(url, at.dir, log) : createClickhouseStore(url, log);
  await firstUse(store, kind, at.openMs, log);
  return store;
};

// Calls that overlap share one run: /health asks checks.store and store:<kind> in one probe.
const shared = (check: HealthCheck): HealthCheck => {
  let running: ReturnType<HealthCheck> | undefined;
  return () => (running ??= check().finally(() => (running = undefined)));
};

// checks.store as before; a URL store adds store:<kind> (the same probe) and its own checks.
export const hostStoreChecks = (store: HostStore | undefined): Record<string, HealthCheck> => {
  if (!store) return {};
  const check = shared(store.probe ?? storeCheck(store));
  const named = store.kind ? { [`store:${store.kind}`]: check } : {};
  return { store: check, ...named, ...store.checks };
};
