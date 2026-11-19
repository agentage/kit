import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { updateInstallation, withFileLock } from './index.js';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { deadPid, freePort } from '../../extension/src/test-support/processes.js';

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

  it('a file that is not JSON is kept as installation.json.bad, then replaced', async () => {
    const dir = await tempDir();
    await writeFile(fileIn(dir), '{ not json');
    await updateInstallation(dir, (doc) => doc);
    expect(await readFile(`${fileIn(dir)}.bad`, 'utf8')).toBe('{ not json');
    expect(JSON.parse(await readFile(fileIn(dir), 'utf8'))).toMatchObject({ extensions: [] });
  });

  it('refuses an unreadable file (EISDIR) with 409 INSTALLATION_UNREADABLE', async () => {
    const dir = await tempDir();
    await mkdir(fileIn(dir));
    await expect(updateInstallation(dir, (doc) => doc)).rejects.toMatchObject({
      status: 409,
      code: 'INSTALLATION_UNREADABLE',
    });
  });

  it('refuses while another live process answers /health as the daemon of that folder', async () => {
    const dir = await tempDir();
    const pid = process.ppid;
    const daemon = createServer((_req, res) =>
      res.end(JSON.stringify({ service: 'agentage-daemon', pid }))
    );
    await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve));
    const port = (daemon.address() as AddressInfo).port;
    await writeFile(join(dir, 'daemon.json'), JSON.stringify({ pid, port }));
    await expect(updateInstallation(dir, (doc) => doc)).rejects.toMatchObject({
      status: 409,
      code: 'DAEMON_RUNNING',
      message: `a daemon (process ${pid}) runs on ${dir}: change it through it`,
    });
    await expect(readFile(fileIn(dir))).rejects.toThrow('ENOENT');
    daemon.close();
  });

  it('writes when daemon.json is stale: a dead pid, or a live one that is not that daemon', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'daemon.json'), JSON.stringify({ pid: deadPid(), port: 1 }));
    await updateInstallation(dir, (doc) => doc);
    await writeFile(
      join(dir, 'daemon.json'),
      JSON.stringify({ pid: process.ppid, port: await freePort() })
    );
    await expect(updateInstallation(dir, (doc) => doc)).resolves.toMatchObject({ extensions: [] });
  });
});

describe('withFileLock (the /host export the cli move uses for settings.json)', () => {
  it('runs a sync or async fn under <file>.lock and removes the lock', async () => {
    const file = join(await tempDir(), 'settings.json');
    expect(await withFileLock(file, () => 1)).toBe(1);
    expect(await withFileLock(file, async () => 2)).toBe(2);
    await expect(readFile(`${file}.lock`)).rejects.toThrow('ENOENT');
  });
});
