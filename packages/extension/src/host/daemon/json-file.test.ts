import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test-support/packages.js';
import { deadPid } from '../../test-support/processes.js';
import { readJsonFile, withFileLock, writeJsonFile } from './json-file.js';

describe('json files of the daemon', () => {
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
});
