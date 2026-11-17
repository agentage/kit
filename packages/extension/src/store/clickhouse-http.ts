// The ClickHouse HTTP interface with fetch: no client library in the kit or in the cli bundle.
interface ClickhouseConnection {
  origin: string;
  username: string;
  password: string;
  database: string;
}

export type ClickhouseParams = Record<string, unknown>;
export type ClickhouseSettings = Record<string, string | number>;

export interface ClickhouseCall {
  sql: string;
  params?: ClickhouseParams;
  settings?: ClickhouseSettings;
  // Rows for an INSERT ... FORMAT JSONEachRow: the SQL then goes in the URL.
  body?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

// The estate's form, http://logs:{pw}@logs_store:8123/logs; the URL was checked by readStoreUrl.
export const connectionOf = (text: string): ClickhouseConnection => {
  const url = new URL(text);
  return {
    origin: url.origin,
    username: decodeURIComponent(url.username) || 'default',
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'default',
  };
};

const ESCAPES: Record<string, string> = { '\\': '\\\\', '\t': '\\t', '\n': '\\n', "'": "\\'" };
const escaped = (s: string) => s.replace(/[\\\t\n']/g, (c) => ESCAPES[c] ?? c);
// Whole seconds fit DateTime and DateTime64; a Date with milliseconds needs DateTime64(3).
const epoch = (d: Date) => {
  const ms = d.getTime();
  return ms % 1000 === 0 ? String(ms / 1000) : (ms / 1000).toFixed(3);
};
const inner = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'string') return `'${escaped(v)}'`;
  if (v instanceof Date) return epoch(v);
  return Array.isArray(v) ? `[${v.map(inner).join(',')}]` : value(v);
};

// A {name:Type} parameter in the escaped text form ClickHouse reads from param_<name>.
export const value = (v: unknown): string => {
  if (v === null || v === undefined) return '\\N';
  if (typeof v === 'string') return escaped(v);
  if (Array.isArray(v)) return `[${v.map(inner).join(',')}]`;
  if (v instanceof Date) return epoch(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v as number | boolean);
};

const urlOf = (c: ClickhouseConnection, call: ClickhouseCall): URL => {
  const url = new URL('/', c.origin);
  url.searchParams.set('database', c.database);
  for (const [k, v] of Object.entries(call.settings ?? {})) url.searchParams.set(k, String(v));
  for (const [k, v] of Object.entries(call.params ?? {}))
    url.searchParams.set(`param_${k}`, value(v));
  if (call.body !== undefined) url.searchParams.set('query', call.sql);
  return url;
};

// ClickHouse's own code (159, 243, ...) on err.code, as @clickhouse/client gives it.
const failure = async (res: Response): Promise<Error> => {
  const text = (await res.text()).trim();
  const code = res.headers.get('x-clickhouse-exception-code') ?? /Code: (\d+)/.exec(text)?.[1];
  // No ClickHouse code: a proxy or the edge answered, never the server itself.
  return Object.assign(new Error(text || `clickhouse answered ${res.status}`), {
    code: code ?? `HTTP_${res.status}`,
  });
};

const signalOf = (call: ClickhouseCall) => {
  const timeout = AbortSignal.timeout(call.timeoutMs);
  return call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
};

// One POST; the answer's text, or an Error carrying ClickHouse's code.
export const request = async (c: ClickhouseConnection, call: ClickhouseCall): Promise<string> => {
  const res = await fetch(urlOf(c, call), {
    method: 'POST',
    headers: { 'X-ClickHouse-User': c.username, 'X-ClickHouse-Key': c.password },
    body: call.body ?? call.sql,
    signal: signalOf(call),
  });
  if (!res.ok) throw await failure(res);
  return res.text();
};

// An error after the first rows comes in the body of a 200: never read it as a row.
const rowOf = <R>(line: string): R => {
  try {
    return JSON.parse(line) as R;
  } catch {
    const code = /Code: (\d+)/.exec(line)?.[1] ?? 'BAD_ROW';
    throw Object.assign(new Error(line.slice(0, 500)), { code });
  }
};

export const rowsOf = <R>(text: string): R[] =>
  text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => rowOf<R>(line));
