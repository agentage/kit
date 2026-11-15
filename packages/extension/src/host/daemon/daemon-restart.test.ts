import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHarness,
  tempConfigDir,
  writeSecrets,
  type Harness,
} from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const installation = (configDir: string) => join(configDir, 'installation.json');

describe('a disabled { id } entry after a restart', () => {
  it('the boot gets its folder from the installer: configure and enable work', async () => {
    const dir = await hostedPackage();
    const install = vi.fn<Installer>(async ({ id }) => ({ id, version: '1.0.0', dir }));
    h = await startHarness({ install });
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { id: 'hosted', enabled: false });
    await h.daemon.stop();
    h = await startHarness({ install, configDir: h.configDir });
    expect(install).toHaveBeenCalledTimes(2);
    const configured = await h.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 'hey' },
    });
    expect(configured).toMatchObject({ status: 200, body: { data: { state: 'disabled' } } });
    const enabled = await h.call('PATCH', '/host/extensions/hosted', { enabled: true });
    expect(enabled).toMatchObject({ status: 200, body: { data: { state: 'running' } } });
    expect((await h.call('GET', '/api/hosted/echo?msg=hi')).body).toMatchObject({
      data: { msg: 'hey hi' },
    });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it('an installer that fails at boot leaves it disabled, with the reason', async () => {
    const configDir = await tempConfigDir();
    const rows = [{ id: 'hosted', version: '1.0.0', enabled: false }];
    await writeFile(installation(configDir), json({ host: 'local', extensions: rows }));
    const install = vi.fn<Installer>(async () => {
      throw Object.assign(new Error('the registry did not answer'), {
        code: 'REGISTRY_DOWN',
        status: 502,
      });
    });
    h = await startHarness({ install, configDir });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [
        { id: 'hosted', state: 'disabled', enabled: false, error: 'the registry did not answer' },
      ],
    });
  });
});

describe('installation.json with an id twice', () => {
  it('runs the first row, keeps the file as .bad, reports invalid, and the next write cleans it', async () => {
    const configDir = await tempConfigDir();
    const first = await hostedPackage(NO_STORE_MANIFEST);
    const second = await hostedPackage();
    const rows = [
      { id: 'hosted', source: first },
      { id: 'hosted', source: second },
    ];
    const text = json({ host: 'local', extensions: rows });
    await writeFile(installation(configDir), text);
    await writeSecrets(configDir);
    h = await startHarness({ configDir });
    expect((await h.call('GET', '/health')).body).toMatchObject({ installation: 'invalid' });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{ id: 'hosted', source: first, state: 'running' }],
    });
    expect(await readFile(`${installation(configDir)}.bad`, 'utf8')).toBe(text);
    const patch = { settings: { 'echo.prefix': 'a' } };
    expect(await h.call('PATCH', '/host/extensions/hosted', patch)).toMatchObject({ status: 200 });
    expect(JSON.parse(await readFile(installation(configDir), 'utf8'))).toEqual({
      host: 'local',
      extensions: [{ id: 'hosted', source: first }],
    });
  });
});

describe('a change queued behind a slow boot', () => {
  it('is 503 after installMs and never runs', async () => {
    const configDir = await tempConfigDir();
    const rows = [
      { id: 'one', version: '1.0.0' },
      { id: 'two', version: '1.0.0' },
    ];
    await writeFile(installation(configDir), json({ host: 'local', extensions: rows }));
    const install = vi.fn<Installer>(() => new Promise(() => undefined));
    const booting = startHarness({ install, configDir, installMs: 400 });
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const port = JSON.parse(await readFile(join(configDir, 'daemon.json'), 'utf8')).port as number;
    const res = await fetch(`http://127.0.0.1:${port}/host/extensions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'three' }),
    });
    expect([res.status, await res.json()]).toMatchObject([
      503,
      { error: { code: 'UNAVAILABLE', message: 'other changes ran for 400 ms: try again' } },
    ]);
    h = await booting;
    expect(install.mock.calls.map(([spec]) => spec.id)).toEqual(['one', 'two']);
  });
});
