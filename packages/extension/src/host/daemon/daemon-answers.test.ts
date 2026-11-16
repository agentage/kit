import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHarness,
  tempConfigDir,
  writeSecrets,
  type Harness,
  hostTokenOf,
} from '../../test-support/daemon-harness.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { freePort } from '../../test-support/processes.js';
import { startDaemon, type Daemon } from './daemon.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
let booted: Daemon | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  await booted?.stop();
  h = booted = undefined;
  vi.restoreAllMocks();
});

const SETTINGS = {
  'echo.prefix': { type: 'string', default: '' },
  limit: { type: 'integer', default: 1 },
  ratio: { type: 'number', default: 0.5 },
  verbose: { type: 'boolean', default: false },
};
const typed = { ...HOSTED_MANIFEST, agentage: { ...HOSTED_MANIFEST.agentage, settings: SETTINGS } };

const withTyped = async () => {
  h = await startHarness();
  await writeSecrets(h.configDir);
  await h.call('POST', '/host/extensions', { source: await hostedPackage(typed) });
  return h;
};
const patch = (settings: Record<string, unknown>) =>
  h!.call('PATCH', '/host/extensions/hosted', { settings });
const errorOf = (r: { body: unknown }) =>
  (r.body as { error: { code: string; message: string } }).error;

describe('daemon answers', () => {
  it('a string setting becomes the declared type; a value of that type passes', async () => {
    await withTyped();
    const changed = await patch({ limit: '5', ratio: '2.5', verbose: 'true', 'echo.prefix': '7' });
    expect(changed.status).toBe(200);
    expect(await patch({ limit: 6, verbose: false })).toMatchObject({ status: 200 });
    const file = await readFile(join(h!.configDir, 'settings.json'), 'utf8');
    expect(JSON.parse(file)).toEqual({
      hosted: { limit: 6, ratio: 2.5, verbose: false, 'echo.prefix': '7' },
    });
  });

  it.each([
    [{ limit: '5.5' }, 'limit', 'integer'],
    [{ limit: 'five' }, 'limit', 'integer'],
    [{ ratio: '' }, 'ratio', 'number'],
    [{ verbose: 'yes' }, 'verbose', 'boolean'],
    [{ verbose: 1 }, 'verbose', 'boolean'],
  ])('%j is 400 INVALID_SETTING naming the key and the type', async (settings, key, type) => {
    await withTyped();
    const refused = await patch(settings);
    expect(refused.status).toBe(400);
    expect(errorOf(refused).code).toBe('INVALID_SETTING');
    expect(errorOf(refused).message).toContain(`setting ${key}`);
    expect(errorOf(refused).message).toContain(type);
  });

  it('an unknown setting is 400 INVALID_SETTING and writes nothing', async () => {
    await withTyped();
    const refused = await patch({ nope: '1' });
    expect(errorOf(refused)).toMatchObject({ code: 'INVALID_SETTING' });
    expect(errorOf(refused).message).toContain('nope');
  });

  it('an installer error with a code reaches the client with that code, message and status', async () => {
    const install = vi
      .fn<Installer>()
      .mockRejectedValueOnce(
        Object.assign(new Error('no such extension: typo'), { code: 'not_found', status: 404 })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('npm is down'), { code: 'NPM_FAILED', status: 502 })
      )
      .mockRejectedValueOnce(Object.assign(new Error('private'), { code: 'private_entry' }));
    h = await startHarness({ install });
    const a = await h.call('POST', '/host/extensions', { id: 'typo' });
    expect(a).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found', message: 'no such extension: typo' } },
    });
    const b = await h.call('POST', '/host/extensions', { id: 'probe' });
    expect(b).toMatchObject({
      status: 502,
      body: { error: { code: 'NPM_FAILED', message: 'npm is down' } },
    });
    const c = await h.call('POST', '/host/extensions', { id: 'probe' });
    expect(c).toMatchObject({ status: 400, body: { error: { code: 'private_entry' } } });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({ data: [] });
  });

  it('an installer error with no code stays 500 Internal error and is logged', async () => {
    const stderr = vi.mocked(process.stderr.write);
    const install = vi.fn<Installer>().mockRejectedValue(new Error('disk on fire'));
    h = await startHarness({ install });
    const failed = await h.call('POST', '/host/extensions', { id: 'probe' });
    expect(failed).toMatchObject({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Internal error' } },
    });
    expect(stderr.mock.calls.map(([row]) => String(row)).join('')).toContain('disk on fire');
  });

  it('a change that arrives while the boot still starts extensions waits for the boot', async () => {
    const configDir = await tempConfigDir();
    const extensions = [{ id: 'hosted', version: '1.0.0' }];
    await writeFile(join(configDir, 'installation.json'), json({ host: 'local', extensions }));
    await writeSecrets(configDir);
    const dir = await hostedPackage();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const order: string[] = [];
    const install = vi.fn<Installer>(async ({ id }) => {
      order.push(`install ${id}`);
      if (order.length === 1) await held;
      order.push(`installed ${id}`);
      return { id, version: '1.0.0', dir };
    });
    const port = await freePort();
    const starting = startDaemon(
      { configDir, port, version: '0.13.0', startedBy: 'test', install },
      inProcessLaunch
    );
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    const auth = { authorization: `Bearer ${await hostTokenOf(configDir)}` };
    const change = fetch(`http://127.0.0.1:${port}/host/extensions/hosted`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ settings: { 'echo.prefix': 'hey' } }),
    }).then((res) => (order.push(`patch ${res.status}`), res.status));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(order).toEqual(['install hosted']);
    release();
    booted = await starting;
    expect(await change).toBe(200);
    expect(order.slice(0, 2)).toEqual(['install hosted', 'installed hosted']);
    expect(order.at(-1)).toBe('patch 200');
  });
});
