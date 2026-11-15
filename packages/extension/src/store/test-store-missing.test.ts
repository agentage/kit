import { describe, expect, it } from 'vitest';
import { tempDir } from '../test-support/packages.js';
import { loadPglite, pgliteMissing } from './pglite-store.js';

const missing = async () => {
  throw Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' });
};
const ROOT = new URL('../../../..', import.meta.url).pathname;

describe('loadPglite without the kit copy', () => {
  it('names each place it looked; another error of the kit copy stays as it is', async () => {
    await expect(loadPglite(undefined, missing)).rejects.toThrow(pgliteMissing(['the kit']));
    const from = await tempDir();
    await expect(loadPglite(from, missing)).rejects.toThrow(pgliteMissing(['the kit', from]));
    const broken = async () => {
      throw new Error('wasm failed');
    };
    await expect(loadPglite(ROOT, broken)).rejects.toThrow('wasm failed');
  });

  it('then loads the copy of the hosted package', async () => {
    const { PGlite } = await loadPglite(ROOT, missing);
    const db = new PGlite();
    expect((await db.query<{ n: number }>('select 1 as n')).rows).toEqual([{ n: 1 }]);
    await db.close();
  });
});
