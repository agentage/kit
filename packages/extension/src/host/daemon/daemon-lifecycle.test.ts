import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, tempConfigDir, type Harness } from '../../test-support/daemon-harness.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { readJsonFile } from './json-file.js';
import { NO_INSTALLER } from './supervisor.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const SECRETS = json({ hosted: { 'api-token': 't' }, other: { 'api-token': 't' } });
const withVersion = (version: string) => ({ ...HOSTED_MANIFEST, version });
const NO_STORE = {
  ...HOSTED_MANIFEST,
  agentage: { ...HOSTED_MANIFEST.agentage, parts: { api: true } },
};
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
    await writeFile(join(h.configDir, 'secrets.json'), SECRETS, { mode: 0o600 });
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
    expect(install).toHaveBeenLastCalledWith({ id: 'hosted', version: '1.1.0' });
    const doc = await readJsonFile(join(h.configDir, 'installation.json'), {});
    expect(doc).toEqual({ host: 'local', extensions: [{ id: 'hosted', version: '1.1.0' }] });
  });

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
    await writeFile(join(configDir, 'secrets.json'), SECRETS, { mode: 0o600 });
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
    await writeFile(join(h.configDir, 'secrets.json'), SECRETS, { mode: 0o600 });
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
    ['with a store: holds, stops the old child, starts the new one', HOSTED_MANIFEST],
    ['without a store: starts the new child, moves the route, drains the old one', NO_STORE],
  ])(
    '60 requests during a PATCH (and 5 open on the old child) lose none, %s',
    async (_name, manifest) => {
      h = await startHarness();
      await writeFile(join(h.configDir, 'secrets.json'), SECRETS, { mode: 0o600 });
      await h.call('POST', '/host/extensions', { source: await hostedPackage(manifest) });
      const { change, answers } = await duringPatch({ settings: { 'echo.prefix': 'hey' } });
      expect(change.status).toBe(200);
      expect(answers.filter((a) => a.status !== 200)).toEqual([]);
      expect(answers.at(-1)?.msg).toBe('hey hi');
    }
  );
});
