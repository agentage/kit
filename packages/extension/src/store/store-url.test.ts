import { describe, expect, it } from 'vitest';
import { tempPackage } from '../test-support/packages.js';
import { isUrlStoreKind, readStoreUrl } from './store-url.js';

const SECRET = 's3cret-pw';

const fileWith = async (text: string) => `${await tempPackage({ 'store-url': text })}/store-url`;

describe('readStoreUrl', () => {
  it('reads and trims a postgres or a clickhouse URL', async () => {
    const pg = `postgres://platform:${SECRET}@store:5432/platform`;
    expect(await readStoreUrl(await fileWith(`${pg}\n`), 'postgres')).toBe(pg);
    const pgql = `postgresql://platform:${SECRET}@store/platform`;
    expect(await readStoreUrl(await fileWith(pgql), 'postgres')).toBe(pgql);
    const ch = `http://logs:${SECRET}@logs_store:8123/logs`;
    expect(await readStoreUrl(await fileWith(ch), 'clickhouse')).toBe(ch);
  });

  it('refuses a missing file, an empty one and a wrong scheme, naming the file, never the value', async () => {
    const errors = [
      await readStoreUrl('/nowhere/store-url', 'postgres').catch((e: Error) => e.message),
      await readStoreUrl(await fileWith(' \n'), 'postgres').catch((e: Error) => e.message),
      await readStoreUrl(await fileWith(`http://u:${SECRET}@h/db`), 'postgres').catch(
        (e: Error) => e.message
      ),
      await readStoreUrl(await fileWith(`postgres://u:${SECRET}@h/db`), 'clickhouse').catch(
        (e: Error) => e.message
      ),
      await readStoreUrl(await fileWith(`${SECRET} not a url`), 'postgres').catch(
        (e: Error) => e.message
      ),
    ];
    expect(errors[0]).toBe('AGENTAGE_STORE_URL_FILE /nowhere/store-url: cannot read it (ENOENT)');
    expect(errors[1]).toMatch(/AGENTAGE_STORE_URL_FILE .*store-url: the file is empty$/);
    expect(errors[2]).toMatch(/holds no postgres:\/\/ URL for the postgres store$/);
    expect(errors[3]).toMatch(/holds no http:\/\/ or https:\/\/ URL for the clickhouse store$/);
    expect(errors[4]).toMatch(/holds no postgres:\/\/ URL/);
    for (const message of errors) expect(message).not.toContain(SECRET);
  });

  it('a read error without a code is named by its message', async () => {
    const read = async () => {
      throw new Error('boom');
    };
    await expect(readStoreUrl('/x', 'postgres', read)).rejects.toThrow('cannot read it (boom)');
  });
});

describe('isUrlStoreKind', () => {
  it('is true for postgres and clickhouse only', () => {
    expect(['postgres', 'clickhouse', 'signoz', 'git', undefined].map(isUrlStoreKind)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
