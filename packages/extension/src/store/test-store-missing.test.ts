import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createTestStore, PGLITE_MISSING } from './test-store.js';

vi.mock('@electric-sql/pglite', () => {
  throw new Error('Cannot find package @electric-sql/pglite');
});

describe('a store without @electric-sql/pglite', () => {
  it('names the missing peer, also when the package folder has none', async () => {
    const prepare = async () => undefined;
    await expect(createTestStore(prepare).query('select 1')).rejects.toThrow(PGLITE_MISSING);
    const from = { from: tmpdir() };
    await expect(createTestStore(prepare, from).query('select 1')).rejects.toThrow(PGLITE_MISSING);
  });
});
