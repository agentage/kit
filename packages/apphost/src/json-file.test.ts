import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { deadPid } from '../../extension/src/test-support/processes.js';
import {
  LOCK_WAIT_MS,
  readJsonFile,
  unwritable,
  withFileLock,
  writeJsonFile,
} from './json-file.js';

describe('json files of the daemon', () => {
  it('a folder over its quota is 503 EDQUOT, though Node names no code for it', () => {
    const quota = Object.assign(new Error('Unknown system error -122, write'), {
      errno: -122,
      code: 'Unknown system error -122',
    });
    expect(unwritable('/c/a.json', quota)).toMatchObject({
      status: 503,
      message: expect.stringContaining('a.json cannot be written (EDQUOT)'),
    });
    const other = Object.assign(new Error('x'), { code: 'EIO' });
    expect(unwritable('/c/a.json', other)).toBe(other);
  });

  it('writes whole files with their mode; a missing file is the fallback, a folder throws', async () => {
    const dir = await tempDir();
    const file = join(dir, 'a.json');
    expect(await readJsonFile(file, 'none')).toBe('none');
    await writeJsonFile(file, { a: 1 }, 0o600);
    expect(await readJsonFile(file, {})).toEqual({ a: 1 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(readJsonFile(dir, {})).rejects.toThrow('EISDIR');
  });

  it('the lock runs one writer at a time and takes over the lock of a dead process', async () => {
    const dir = await tempDir();
    const file = join(dir, 'n.json');
    await writeJsonFile(file, 0);
    const bump = () =>
      withFileLock(file, async () => writeJsonFile(file, (await readJsonFile(file, 0)) + 1));
    await Promise.all(Array.from({ length: 50 }, bump));
    expect(await readJsonFile(file, 0)).toBe(50);
    await writeFile(`${file}.lock`, String(deadPid()));
    await bump();
    expect(JSON.parse(await readFile(file, 'utf8'))).toBe(51);
    expect(await readdir(dir)).toEqual(['n.json']);
  });

  it('a live holder is waited for at most waitMs, then 503 naming its pid; fn never runs', async () => {
    const file = join(await tempDir(), 'installation.json');
    await writeFile(`${file}.lock`, String(process.ppid));
    const fn = vi.fn(async () => undefined);
    const started = Date.now();
    await expect(withFileLock(file, fn, 120)).rejects.toMatchObject({
      status: 503,
      code: 'UNAVAILABLE',
      message: `installation.json is locked by process ${process.ppid}: waited 120 ms`,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('with no waitMs it gives up after LOCK_WAIT_MS (5 s)', async () => {
    const file = join(await tempDir(), 'settings.json');
    await writeFile(`${file}.lock`, String(process.ppid));
    const now = Date.now();
    // The clock jumps LOCK_WAIT_MS after the deadline is set, so the test does not wait 5 s.
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValue(now + LOCK_WAIT_MS);
    await expect(withFileLock(file, async () => undefined)).rejects.toMatchObject({
      message: `settings.json is locked by process ${process.ppid}: waited ${LOCK_WAIT_MS} ms`,
    });
    vi.restoreAllMocks();
  });
});
