import { describe, expect, it } from 'vitest';
import { isFailure } from '../envelope/envelope.js';
import { closedPort, fakeClickhouse } from '../test-support/fake-clickhouse.js';
import { recordedLog } from '../test-support/http.js';
import { connectionOf, rowsOf, value } from './clickhouse-http.js';
import {
  clickhouseOf,
  createClickhouseStore,
  isClickhouseOutage,
  isClickhouseStore,
} from './clickhouse-store.js';

describe('createClickhouseStore', () => {
  it('query sends the SQL, named params, settings and the credentials; rows come back', async () => {
    const ch = await fakeClickhouse(() => ({ body: '{"n":1}\n{"n":2}\n' }));
    const store = createClickhouseStore(ch.url, recordedLog().log);
    const sql = 'SELECT n FROM t WHERE k = {k:String} AND n IN {ns:Array(UInt8)}';
    const { rows } = await store.query(sql, { k: "it's", ns: [1, 2] }, { settings: { a: 1 } });
    expect(rows).toEqual([{ n: 1 }, { n: 2 }]);
    const [one] = ch.seen;
    expect(one?.body).toBe(sql);
    expect([one?.user, one?.key]).toEqual(['logs', 'p@ss']);
    const params = Object.fromEntries(one?.url.searchParams ?? []);
    expect(params).toMatchObject({ database: 'platform_logs', default_format: 'JSONEachRow' });
    expect(params).toMatchObject({ param_k: "it\\'s", param_ns: '[1,2]', a: '1' });
    expect(params).toMatchObject({ output_format_json_quote_64bit_integers: '0' });
    expect(params).toMatchObject({ wait_end_of_query: '1' });
    expect(await store.query('SELECT 1', [])).toEqual({ rows: [{ n: 1 }, { n: 2 }] });
    expect(ch.seen[1]?.url.searchParams.has('param_0')).toBe(false);
    await expect(store.query('SELECT {0:UInt8}', [1])).rejects.toThrow(/named parameters/);
  });

  it('insert puts the SQL in the URL and JSONEachRow rows in the body; command sends the SQL', async () => {
    const ch = await fakeClickhouse(() => ({}));
    const store = createClickhouseStore(ch.url, recordedLog().log);
    const settings = { insert_deduplication_token: 'tok', async_insert_deduplicate: 1 };
    await store.insert('events', [{ a: 1 }, { a: 2 }], { settings });
    await store.command('CREATE TABLE IF NOT EXISTS events (a UInt8) ENGINE = Memory');
    const [insert, command] = ch.seen;
    expect(insert?.url.searchParams.get('query')).toBe('INSERT INTO events FORMAT JSONEachRow');
    expect(insert?.url.searchParams.get('insert_deduplication_token')).toBe('tok');
    expect(insert?.body).toBe('{"a":1}\n{"a":2}');
    expect(command?.body).toMatch(/^CREATE TABLE/);
    await expect(store.insert('events; DROP', [])).rejects.toThrow('not a table name');
    await store.close();
  });

  it('a ClickHouse error carries its own code; it is not an outage', async () => {
    const ch = await fakeClickhouse(() => ({ status: 500, code: '159', body: 'Code: 159. slow' }));
    const store = createClickhouseStore(ch.url, recordedLog().log);
    const err = await store.query('SELECT 1').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: '159', message: 'Code: 159. slow' });
    expect(isFailure(err)).toBe(false);
    const bare = await fakeClickhouse(() => ({ status: 404, body: 'Code: 60. no table' }));
    const other = createClickhouseStore(bare.url, recordedLog().log);
    await expect(other.command('x')).rejects.toMatchObject({ code: '60' });
    const empty = await fakeClickhouse(() => ({ status: 502 }));
    const third = createClickhouseStore(empty.url, recordedLog().log);
    await expect(third.command('x')).rejects.toMatchObject({ code: '502' });
  });

  it('a store that cannot be reached or answers too late is UNAVAILABLE; ping says false', async () => {
    const { log, lines } = recordedLog();
    const down = createClickhouseStore(`http://u:p@127.0.0.1:${await closedPort()}/db`, log);
    const err = await down.query('SELECT 1').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'UNAVAILABLE', status: 503 });
    expect(lines).toMatchObject([{ level: 'warn', msg: 'store unavailable' }]);
    expect(await down.ping()).toBe(false);
    const slow = await fakeClickhouse(() => ({ wait: 300 }));
    const late = createClickhouseStore(slow.url, log, 50);
    await expect(late.command('SELECT 1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const up = await fakeClickhouse(() => ({ body: '1\n' }));
    expect(await createClickhouseStore(up.url, log).ping()).toBe(true);
  });

  it('a caller abort passes through as it is', async () => {
    const slow = await fakeClickhouse(() => ({ wait: 300 }));
    const store = createClickhouseStore(slow.url, recordedLog().log);
    const signal = AbortSignal.abort();
    const err = await store.query('SELECT 1', {}, { signal }).catch((e: unknown) => e);
    expect(isFailure(err)).toBe(false);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('clickhouse helpers', () => {
  it('value writes the escaped text form of a parameter (checked on a 26.8 server)', () => {
    expect(value(null)).toBe('\\N');
    expect(value("a\\b\tc\nd'e")).toBe("a\\\\b\\tc\\nd\\'e");
    expect(value(['a', "b'c", null, 1, ['x']])).toBe("['a','b\\'c',NULL,1,['x']]");
    expect(value(new Date('2026-01-01T00:00:00Z'))).toBe('1767225600');
    expect(value(new Date('2026-01-01T00:00:00.123Z'))).toBe('1767225600.123');
    expect(value([new Date('2026-01-01T00:00:00Z')])).toBe('[1767225600]');
    expect(value({ a: 1 })).toBe('{"a":1}');
    expect(value(true)).toBe('true');
  });

  it('an error after the first rows is an error with its code, not a row', () => {
    expect(rowsOf('{"n":1}\n')).toEqual([{ n: 1 }]);
    expect(() => rowsOf('{"n":1}\nCode: 395. DB::Exception: late')).toThrow(
      expect.objectContaining({ code: '395' })
    );
    expect(() => rowsOf('{"n":')).toThrow(expect.objectContaining({ code: 'BAD_ROW' }));
  });

  it('connectionOf defaults the user and the database', () => {
    expect(connectionOf('http://h:8123')).toEqual({
      origin: 'http://h:8123',
      username: 'default',
      password: '',
      database: 'default',
    });
  });

  it('isClickhouseOutage reads the code and its cause', () => {
    const coded = (code: string) => Object.assign(new Error('x'), { code });
    expect(isClickhouseOutage(coded('ECONNRESET'))).toBe(true);
    expect(isClickhouseOutage(new Error('x', { cause: { code: 'ENOTFOUND' } }))).toBe(true);
    expect(isClickhouseOutage(new TypeError('fetch failed'))).toBe(true);
    expect(isClickhouseOutage(coded('159'))).toBe(false);
    expect(isClickhouseOutage(null)).toBe(false);
  });

  it('clickhouseOf gives the face of ctx.store, else one that says what is missing', async () => {
    const store = createClickhouseStore('http://h:8123', recordedLog().log);
    expect(isClickhouseStore(store)).toBe(true);
    expect(clickhouseOf({ store })).toBe(store);
    const none = clickhouseOf({ store: { query: async () => ({ rows: [] }) } });
    await expect(none.query('SELECT 1')).rejects.toThrow(/no clickhouse store/);
    await expect(none.insert('t', [])).rejects.toThrow(/no clickhouse store/);
    await expect(none.command('x')).rejects.toThrow(/no clickhouse store/);
    expect(await none.ping()).toBe(false);
    await none.close();
  });
});
