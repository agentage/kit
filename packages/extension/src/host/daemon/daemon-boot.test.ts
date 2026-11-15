import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHarness,
  tempConfigDir,
  writeSecrets,
  type Harness,
} from '../../test-support/daemon-harness.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { hostedPackage } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { freePort } from '../../test-support/processes.js';
import { startDaemon } from './daemon.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

describe('daemon boot with a bad installation.json', () => {
  it('a file that is not JSON: starts empty, /health says invalid, a copy is kept as .bad', async () => {
    const configDir = await tempConfigDir();
    await writeFile(join(configDir, 'installation.json'), '{"host": "local", "exten');
    h = await startHarness({ configDir });
    expect((await h.call('GET', '/health')).body).toMatchObject({
      status: 'degraded',
      installation: 'invalid',
      extensions: [],
    });
    const bad = await readFile(join(configDir, 'installation.json.bad'), 'utf8');
    expect(bad).toBe('{"host": "local", "exten');
    const now = JSON.parse(await readFile(join(configDir, 'installation.json'), 'utf8'));
    expect(now).toEqual({ host: 'local', extensions: [] });
  });

  it('a file that turns not JSON after boot: each change is 409, its rows stay, then a fix is enough', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    const file = join(h.configDir, 'installation.json');
    const kept = await readFile(file, 'utf8');
    await writeFile(file, kept.slice(0, -5));
    const patch = { settings: { 'echo.prefix': 'hey' } };
    expect(await h.call('PATCH', '/host/extensions/hosted', patch)).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'INSTALLATION_UNREADABLE',
          message: 'installation.json cannot be read (not JSON): fix it; no change is written',
        },
      },
    });
    expect(await h.call('DELETE', '/host/extensions/hosted')).toMatchObject({ status: 409 });
    expect(await readFile(file, 'utf8')).toBe(kept.slice(0, -5));
    expect((await h.call('GET', '/api/hosted/echo?msg=hi')).status).toBe(200);
    const health = async () => (await h!.call('GET', '/health')).body;
    expect(await health()).toMatchObject({ status: 'degraded', installation: 'invalid' });
    await writeFile(file, kept);
    expect(await h.call('PATCH', '/host/extensions/hosted', patch)).toMatchObject({ status: 200 });
    expect(await health()).toMatchObject({ status: 'ok' });
    expect(await health()).not.toHaveProperty('installation');
    expect(await readFile(file, 'utf8')).toBe(kept);
  });

  it('invalid rows are left out, the valid ones run; no data folder of a bad id is deleted', async () => {
    const configDir = await tempConfigDir();
    await mkdir(join(configDir, 'x'), { recursive: true });
    await mkdir(join(configDir, 'data', 'Bad'), { recursive: true });
    const extensions = [
      { id: 'hosted', source: await hostedPackage() },
      { id: '../x' },
      { id: 'Bad' },
    ];
    await writeFile(join(configDir, 'installation.json'), json({ host: 'local', extensions }));
    await writeSecrets(configDir);
    h = await startHarness({ configDir });
    const health = (await h.call('GET', '/health')).body;
    expect(health).toMatchObject({
      installation: 'invalid',
      extensions: [{ id: 'hosted', state: 'running' }],
    });
    await h.call('DELETE', '/host/extensions/hosted?purge=true');
    expect((await stat(join(configDir, 'x'))).isDirectory()).toBe(true);
    expect((await stat(join(configDir, 'data', 'Bad'))).isDirectory()).toBe(true);
  });

  it('a boot that fails (daemon.json cannot be written) closes the server and rejects', async () => {
    const configDir = await tempConfigDir();
    await mkdir(join(configDir, 'daemon.json'));
    const port = await freePort();
    const opts = { configDir, port, version: 't', startedBy: 'test' };
    await expect(startDaemon(opts, inProcessLaunch)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});

describe('a file that turns not JSON while a change runs', () => {
  it('is never written: the change is 409 when it comes to write', async () => {
    const dir = await hostedPackage();
    let release = () => undefined as void;
    const install = vi.fn<Installer>(async ({ id, version = '1.0.0' }) => {
      if (version !== '1.0.0') await new Promise<void>((resolve) => (release = resolve));
      return { id, version, dir };
    });
    h = await startHarness({ install });
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { id: 'hosted' });
    const patched = h.call('PATCH', '/host/extensions/hosted', { version: '1.1.0' });
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    const file = join(h.configDir, 'installation.json');
    await writeFile(file, '{ not json');
    release();
    expect(await patched).toMatchObject({
      status: 409,
      body: { error: { code: 'INSTALLATION_UNREADABLE' } },
    });
    expect(await readFile(file, 'utf8')).toBe('{ not json');
  });
});

describe('daemon boot with a file that has no host', () => {
  it('reads host as local and keeps the rows', async () => {
    const configDir = await tempConfigDir();
    const extensions = [{ id: 'hosted', source: await hostedPackage() }];
    await writeFile(join(configDir, 'installation.json'), json({ extensions }));
    h = await startHarness({ configDir });
    const health = (await h.call('GET', '/health')).body as Record<string, unknown>;
    expect(health['installation']).toBeUndefined();
    expect(health).toMatchObject({ extensions: [{ id: 'hosted' }] });
  });
});
