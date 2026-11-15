import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updateInstallation } from '../index.js';
import { tempDir } from '../../test-support/packages.js';

const fileIn = (dir: string) => join(dir, 'installation.json');

describe('updateInstallation (the /host export the cli move uses)', () => {
  it('reads, changes and writes under the lock; unknown keys round-trip', async () => {
    const dir = await tempDir();
    await writeFile(fileIn(dir), JSON.stringify({ host: 'local', extensions: [], note: 1 }));
    const add = { id: 'probe', version: '0.7.0' };
    const next = await updateInstallation(dir, (doc) => ({ ...doc, extensions: [add] }));
    expect(next).toEqual({ host: 'local', note: 1, extensions: [add] });
    expect(JSON.parse(await readFile(fileIn(dir), 'utf8'))).toEqual(next);
    await expect(readFile(`${fileIn(dir)}.lock`)).rejects.toThrow('ENOENT');
  });

  it('refuses a row C3 refuses or an id twice, and writes nothing', async () => {
    const dir = await tempDir();
    const twice = { host: 'local', extensions: [{ id: 'a' }, { id: 'a' }] };
    await expect(updateInstallation(dir, () => twice)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const relative = { host: 'local', extensions: [{ id: 'a', source: 'rel/dir' }] };
    await expect(updateInstallation(dir, () => relative)).rejects.toMatchObject({ status: 400 });
    await expect(readFile(fileIn(dir))).rejects.toThrow('ENOENT');
  });

  it('refuses an unreadable file (EISDIR) with 409 INSTALLATION_UNREADABLE', async () => {
    const dir = await tempDir();
    await mkdir(fileIn(dir));
    await expect(updateInstallation(dir, (doc) => doc)).rejects.toMatchObject({
      status: 409,
      code: 'INSTALLATION_UNREADABLE',
    });
  });
});
