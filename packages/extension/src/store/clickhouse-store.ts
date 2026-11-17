import { fail } from '../envelope/envelope.js';
import { messageOf, type Log } from '../log/log.js';
import {
  connectionOf,
  request,
  rowsOf,
  type ClickhouseCall,
  type ClickhouseParams,
  type ClickhouseSettings,
} from './clickhouse-http.js';
import { type QueryResult, type Row } from './store.types.js';

export interface ClickhouseOptions {
  settings?: ClickhouseSettings;
  signal?: AbortSignal;
}

// ctx.store of a clickhouse store; clickhouseOf(ctx) gives this face. Named parameters: {name:Type}.
export interface ClickhouseStore {
  readonly kind: 'clickhouse';
  query<R extends Row = Row>(
    sql: string,
    params?: ClickhouseParams | unknown[],
    options?: ClickhouseOptions
  ): Promise<QueryResult<R>>;
  command(sql: string, options?: ClickhouseOptions): Promise<void>;
  // JSONEachRow; pass insert_deduplication_token in settings so a retried batch is a no-op.
  insert(table: string, rows: object[], options?: ClickhouseOptions): Promise<void>;
  // SELECT 1 with the store's credentials: false, never a throw.
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

// Counts as JSON numbers; the whole answer before the status, so a late error is a 500, not a 200.
const READS: ClickhouseSettings = {
  output_format_json_quote_64bit_integers: 0,
  wait_end_of_query: 1,
};
const TABLE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const PING_MS = 900;

const OUTAGE = /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|EPIPE)$/;
// 159 timeout, 202 too many queries; a proxy's 502-504 with no ClickHouse code.
const BUSY = /^(159|202|HTTP_50[234])$/;
const codeOf = (err: unknown): string => {
  const own = (err as { code?: unknown } | null)?.code;
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return String(own ?? cause ?? '');
};

// undici: "fetch failed" before the answer, "terminated" when the socket closes mid-body.
const NETWORK = (err: unknown) =>
  err instanceof TypeError && /^(fetch failed|terminated)$/.test(err.message);

// A store that cannot answer now is UNAVAILABLE, as in store.ts; a caller's abort and a query error pass through.
export const isClickhouseOutage = (err: unknown): boolean =>
  OUTAGE.test(codeOf(err)) ||
  BUSY.test(codeOf(err)) ||
  NETWORK(err) ||
  (err as { name?: string } | null)?.name === 'TimeoutError';

const guarded = (log: Log) => async (work: () => Promise<string>) => {
  try {
    return await work();
  } catch (err) {
    if (!isClickhouseOutage(err)) throw err;
    log.warn('store unavailable', { reason: messageOf(err) });
    throw fail('UNAVAILABLE', 'The store is unavailable');
  }
};

const named = (params: ClickhouseParams | unknown[] | undefined): ClickhouseParams | undefined => {
  if (!Array.isArray(params)) return params;
  if (params.length === 0) return undefined;
  throw new Error('a clickhouse query takes named parameters: {name:Type} and an object');
};

const ndjson = (rows: object[]) => rows.map((row) => JSON.stringify(row)).join('\n');

type Call = (c: Omit<ClickhouseCall, 'timeoutMs'>) => Promise<string>;

const queryOf =
  (call: Call): ClickhouseStore['query'] =>
  async <R extends Row>(sql: string, params?: ClickhouseParams | unknown[], o = {}) => {
    const { settings, signal } = o as ClickhouseOptions;
    const all = { default_format: 'JSONEachRow', ...READS, ...settings };
    return { rows: rowsOf<R>(await call({ sql, params: named(params), settings: all, signal })) };
  };

const insertOf =
  (call: Call): ClickhouseStore['insert'] =>
  async (table, rows, o = {}) => {
    if (!TABLE.test(table)) throw new Error(`not a table name: ${table}`);
    await call({ sql: `INSERT INTO ${table} FORMAT JSONEachRow`, body: ndjson(rows), ...o });
  };

// A store client over the HTTP interface; nothing connects until the first call.
export const createClickhouseStore = (url: string, log: Log, timeoutMs = 10_000) => {
  const at = connectionOf(url);
  const run = guarded(log);
  const call: Call = (c) => run(() => request(at, { ...c, timeoutMs }));
  const ping = () => request(at, { sql: 'SELECT 1', timeoutMs: PING_MS });
  const store: ClickhouseStore = {
    kind: 'clickhouse',
    query: queryOf(call),
    command: async (sql, o = {}) => void (await call({ sql, ...o })),
    insert: insertOf(call),
    ping: () =>
      ping().then(
        () => true,
        () => false
      ),
    close: async () => undefined,
  };
  return store;
};

export const isClickhouseStore = (store: unknown): store is ClickhouseStore =>
  (store as { kind?: unknown } | null)?.kind === 'clickhouse';

const NO_CLICKHOUSE =
  'no clickhouse store: declare parts.store "clickhouse" and set AGENTAGE_STORE_URL_FILE';
const missing = async (): Promise<never> => {
  throw new Error(NO_CLICKHOUSE);
};

// Says so on first use, as ctx.store does: the check and test contexts run create() with no store.
const NO_CLICKHOUSE_STORE: ClickhouseStore = Object.freeze({
  kind: 'clickhouse',
  query: missing,
  command: missing,
  insert: missing,
  ping: async () => false,
  close: async () => undefined,
});

// ctx.store as the clickhouse face; the PartContext type stays as it is.
export const clickhouseOf = (ctx: { readonly store: unknown }): ClickhouseStore =>
  isClickhouseStore(ctx.store) ? ctx.store : NO_CLICKHOUSE_STORE;
