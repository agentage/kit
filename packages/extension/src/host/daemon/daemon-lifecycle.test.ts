import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHarness,
  tempConfigDir,
  writeSecrets,
  type Harness,
} from '../../test-support/daemon-harness.js';
import {
  HOSTED_MANIFEST,
  hostedPackage,
  NO_STORE_MANIFEST as NO_STORE,
} from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { readJsonFile } from './json-file.js';
import { NO_INSTALLER } from './installer-call.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const withVersion = (version: string) => ({ ...HOSTED_MANIFEST, version });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 5 slow requests open on the old child, then 60 more, 5 ms apart, while the PATCH swaps it.
const duringPatch = async (patch: object) => {
  const slow = Array.from({ length: 5 }, () => h!.call('GET', '/api/hosted/slow'));
  await pause(20);
  const change = h!.call('PATCH', '/host/extensions/hosted', patch);
  const sent = Array.from({ length: 60 }, async (_, i) => {
    await pause(i * 5);
    const res = await fetch(`http://127.0.0.1:${h!.daemon.port}/api/hosted/echo?msg=hi`);
    return {
      status: res.status,
      msg: ((await res.json()) as { data?: { msg?: string } }).data?.msg,
    };
  });
  const answers = await Promise.all(sent);
  const open = (await Promise.all(slow)).map((r) => r.status);
  return {
    change: await change,
    answers: [...open.map((status) => ({ status, msg: 'slow' })), ...answers],
  };
};

describe('daemon lifecycle', () => {
  it('installs { id, version } through the installer and moves it to another version', async () => {
    const dirs: Record<string, string> = {
      '1.0.0': await hostedPackage(withVersion('1.0.0')),
      '1.1.0': await hostedPackage(withVersion('1.1.0')),
    };
    const install = vi.fn(async ({ id, version = '1.0.0' }: { id: string; version?: string }) => ({
      id,
      version,
      dir: dirs[version]!,
    }));
    h = await startHarness({ install });
    await writeSecrets(h.configDir, ['hosted', 'other']);
    const added = await h.call('POST', '/host/extensions', { id: 'hosted', version: '1.0.0' });
    expect(added).toMatchObject({
      status: 201,
      body: { data: { id: 'hosted', version: '1.0.0', state: 'running' } },
    });
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{ source: 'market', version: '1.0.0' }],
    });
    const moved = await h.call('PATCH', '/host/extensions/hosted', { version: '1.1.0' });
    expect(moved.body).toMatchObject({ data: { version: '1.1.0', state: 'running' } });
    expect(install).toHaveBeenLastCalledWith({
      id: 'hosted',
      version: '1.1.0',
      signal: expect.any(AbortSignal),
    });
    const doc = await readJsonFile(join(h.configDir, 'installation.json'), {});
    expect(doc).toEqual({ host: 'local', extensions: [{ id: 'hosted', version: '1.1.0' }] });
  });

  it.each([
    ['with a store', HOSTED_MANIFEST],
    ['without a store', NO_STORE],
  ])(
    'a version the new child refuses keeps the old one, also for a later PATCH (%s)',
    async (_n, manifest) => {
      const broken = 'export const create = () => { throw new Error("boom in 2.0.0"); };';
      const dirs: Record<string, string> = {
        '1.0.0': await hostedPackage({ ...manifest, version: '1.0.0' }),
        '2.0.0': await hostedPackage({ ...manifest, version: '2.0.0' }, broken),
      };
      const install = vi.fn(
        async ({ id, version = '1.0.0' }: { id: string; version?: string }) => ({
          id,
          version,
          dir: dirs[version]!,
        })
      );
      h = await startHarness({ install });
      await writeSecrets(h.configDir, ['hosted', 'other']);
      await h.call('POST', '/host/extensions', { id: 'hosted' });
      const refused = await h.call('PATCH', '/host/extensions/hosted', { version: '2.0.0' });
      expect(refused).toMatchObject({
        status: 400,
        body: { error: { message: expect.stringContaining('boom in 2.0.0') } },
      });
      await h.call('PATCH', '/host/extensions/hosted', { settings: { 'echo.prefix': 'hey' } });
      expect((await h.call('GET', '/api/hosted/echo?msg=hi')).body).toMatchObject({
        data: { msg: 'hey hi' },
      });
      expect((await h.call('GET', '/health')).body).toMatchObject({
        extensions: [{ version: '1.0.0', state: 'running' }],
      });
      expect(install).toHaveBeenCalledTimes(2);
      const doc = await readJsonFile(join(h.configDir, 'installation.json'), {});
      expect(doc).toEqual({ host: 'local', extensions: [{ id: 'hosted', version: '1.0.0' }] });
    }
  );

  it('on start runs each enabled extension of installation.json; a failed one stops no other', async () => {
    const configDir = await tempConfigDir();
    const other = { ...NO_STORE, agentage: { ...NO_STORE.agentage, id: 'other' } };
    const extensions = [
      { id: 'hosted', source: await hostedPackage(), store: 'postgres' },
      { id: 'broken', source: '/nonexistent/broken' },
      { id: 'other', source: await hostedPackage(other), enabled: false },
      { id: 'probe', version: '0.6.2' },
    ];
    await writeFile(join(configDir, 'installation.json'), json({ host: 'local', extensions }));
    await writeSecrets(configDir, ['hosted', 'other']);
    h = await startHarness({ configDir });
    const states = (
      (await h.call('GET', '/host/extensions')).body as {
        data: { id: string; state: string; error?: string }[];
      }
    ).data;
    expect(states.map((e) => [e.id, e.state])).toEqual([
      ['hosted', 'running'],
      ['broken', 'failed'],
      ['other', 'disabled'],
      ['probe', 'failed'],
    ]);
    expect(states[3]?.error).toBe(NO_INSTALLER);
    expect((await h.call('GET', '/health')).body).toMatchObject({ status: 'degraded' });
    expect((await h.call('GET', '/api/hosted/echo')).status).toBe(200);
    await h.call('PATCH', '/host/extensions/other', { enabled: true });
    const doc = await readJsonFile(join(configDir, 'installation.json'), {});
    expect(doc).toMatchObject({
      extensions: [{ id: 'hosted', store: 'postgres' }, {}, { id: 'other' }, {}],
    });
  });

  it('stop drains the children and removes daemon.json', async () => {
    h = await startHarness();
    await h.daemon.stop();
    await expect(readJsonFile(join(h.configDir, 'daemon.json'), 'gone')).resolves.toBe('gone');
  });

  it('a store PATCH the new child refuses starts the old one again', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir, ['hosted', 'other']);
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    const refused = await h.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 3 },
    });
    expect(refused.status).toBe(400);
    expect(await h.call('GET', '/api/hosted/echo?msg=hi')).toMatchObject({
      status: 200,
      body: { data: { msg: 'hi' } },
    });
  });

  it.each([
    ['with a store', HOSTED_MANIFEST],
    ['without a store', NO_STORE],
  ])(
    '60 requests during a PATCH (5 open on the old child) wait, then all answer 200, %s',
    async (_name, manifest) => {
      h = await startHarness();
      await writeSecrets(h.configDir, ['hosted', 'other']);
      await h.call('POST', '/host/extensions', { source: await hostedPackage(manifest) });
      const { change, answers } = await duringPatch({ settings: { 'echo.prefix': 'hey' } });
      expect(change.status).toBe(200);
      expect(answers.filter((a) => a.status !== 200)).toEqual([]);
      expect(answers.at(-1)?.msg).toBe('hey hi');
    }
  );
});
