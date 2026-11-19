import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from './test-support/daemon-harness.js';
import {
  HOSTED_MANIFEST,
  hostedPackage,
  NO_STORE_MANIFEST,
} from '../../extension/src/test-support/hosted-fixture.js';
import { readJsonFile } from './json-file.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const SECRET = { 'api-token': 'tok-secret-value' };
const read = (file: string) => readJsonFile<unknown>(join(h!.configDir, file), undefined);

// A folder installed and its secret set: the fixture refuses to start without it.
const installed = async (manifest: object = HOSTED_MANIFEST) => {
  h ??= await startHarness();
  const dir = await hostedPackage(manifest);
  const added = await h.call('POST', '/host/extensions', { source: dir });
  await h.call('PATCH', '/host/extensions/hosted', { secrets: SECRET });
  return { dir, added };
};

describe('daemon routes (C5)', () => {
  it('installs a folder, proxies /api/{id}/*, lists it and writes installation.json and daemon.json', async () => {
    const { dir, added } = await installed();
    expect(added).toMatchObject({
      status: 201,
      body: { success: true, data: { id: 'hosted', state: 'failed' } },
    });
    expect(await h!.call('GET', '/api/hosted/echo?msg=hi')).toMatchObject({
      status: 200,
      body: { data: { msg: 'hi' } },
    });
    const list = await h!.call('GET', '/host/extensions');
    const pid = process.pid;
    const row = {
      id: 'hosted',
      version: '1.0.0',
      pid,
      source: dir,
      state: 'running',
      enabled: true,
    };
    expect(list).toEqual({ status: 200, body: { success: true, data: [row] } });
    expect(await read('installation.json')).toEqual({
      host: 'local',
      extensions: [{ id: 'hosted', source: dir }],
    });
    expect(await read('daemon.json')).toEqual({
      pid,
      port: h!.daemon.port,
      version: '0.13.0',
      protocol: 1,
      startedBy: 'test',
      hostToken: h!.token,
    });
    expect((await stat(join(h!.configDir, 'daemon.json'))).mode & 0o777).toBe(0o600);
    const health = await h!.call('GET', '/health');
    expect(health.body).toEqual({
      status: 'ok',
      version: '0.13.0',
      service: 'agentage-daemon',
      pid: process.pid,
      protocol: 1,
      extensions: [
        {
          id: 'hosted',
          version: '1.0.0',
          state: 'running',
          pid,
          parts: ['api'],
          seal: 'off',
          restarts: 0,
        },
      ],
    });
  });

  it('PATCH settings: the next answer has them; secrets live in a 0600 file no route returns', async () => {
    await installed();
    const changed = await h!.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 'hey' },
    });
    expect(changed.body).toEqual({
      success: true,
      data: { id: 'hosted', version: '1.0.0', state: 'running', pid: process.pid },
    });
    expect((await h!.call('GET', '/api/hosted/echo?msg=hi')).body).toMatchObject({
      data: { msg: 'hey hi' },
    });
    expect(await read('settings.json')).toEqual({ hosted: { 'echo.prefix': 'hey' } });
    expect(await read('secrets.json')).toEqual({ hosted: SECRET });
    expect((await stat(join(h!.configDir, 'secrets.json'))).mode & 0o777).toBe(0o600);
    const seen = JSON.stringify([
      await h!.call('GET', '/host/extensions'),
      await h!.call('GET', '/health'),
      changed,
    ]);
    expect(seen).not.toContain(SECRET['api-token']);
  });

  it('DELETE stops it (404 after), keeps the data folder; ?purge=true deletes it', async () => {
    await installed();
    await h!.call('GET', '/api/hosted/echo');
    expect(await h!.call('DELETE', '/host/extensions/hosted')).toEqual({
      status: 200,
      body: { success: true, data: { id: 'hosted' } },
    });
    const gone = await h!.call('GET', '/api/hosted/echo');
    expect(gone).toMatchObject({
      status: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'hosted is not installed' } },
    });
    const data = join(h!.configDir, 'data', 'hosted');
    expect((await stat(data)).isDirectory()).toBe(true);
    await installed();
    expect((await h!.call('GET', '/api/hosted/echo')).body).toMatchObject({ data: { hits: 2 } });
    await h!.call('DELETE', '/host/extensions/hosted?purge=true');
    await expect(stat(data)).rejects.toThrow('ENOENT');
    expect(await read('secrets.json')).toEqual({});
  });

  it('PATCH enabled: false stops it (404, disabled), true starts it again', async () => {
    await installed();
    expect(
      (await h!.call('PATCH', '/host/extensions/hosted', { enabled: false })).body
    ).toMatchObject({ data: { state: 'disabled' } });
    expect(await h!.call('GET', '/api/hosted/echo')).toMatchObject({
      status: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'hosted is disabled' } },
    });
    expect(await read('installation.json')).toMatchObject({
      extensions: [{ id: 'hosted', enabled: false }],
    });
    expect((await h!.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{ state: 'disabled', enabled: false }],
    });
    expect(
      (await h!.call('PATCH', '/host/extensions/hosted', { enabled: true })).body
    ).toMatchObject({ data: { state: 'running' } });
    expect((await h!.call('GET', '/api/hosted/echo')).status).toBe(200);
    expect(await read('installation.json')).toEqual({
      host: 'local',
      extensions: [{ id: 'hosted', source: expect.any(String) }],
    });
  });

  it('a PATCH with a setting of the wrong type is 400 INVALID_SETTING; the old child runs on', async () => {
    await installed(NO_STORE_MANIFEST);
    const refused = await h!.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 3 },
    });
    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'INVALID_SETTING' } } });
    expect((refused.body as { error: { message: string } }).error.message).toBe(
      'setting echo.prefix: 3 is not a valid string'
    );
    expect(await h!.call('GET', '/api/hosted/echo?msg=hi')).toMatchObject({
      status: 200,
      body: { data: { msg: 'hi' } },
    });
    expect(await read('settings.json')).toEqual({});
  });
});
