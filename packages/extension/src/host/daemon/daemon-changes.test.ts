import { createServer, type Server } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { hostedPackage } from '../../test-support/hosted-fixture.js';
import { type Launch } from './child.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const installed = async (options: Parameters<typeof startHarness>[0] = {}) => {
  h = await startHarness(options);
  await writeSecrets(h.configDir);
  await h.call('POST', '/host/extensions', { source: await hostedPackage() });
  return h;
};
const echo = async () =>
  ((await h!.call('GET', '/api/hosted/echo?msg=hi')).body as { data?: { msg: string } }).data?.msg;

// A child that binds its port and never answers, for the launch number `at`.
const silentAt = (at: number): Launch => {
  let calls = 0;
  return async (spec) => {
    calls += 1;
    if (calls !== at) return inProcessLaunch(spec);
    const server: Server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const stop = async () => void (server.closeAllConnections(), server.close());
    const exited = new Promise<never>(() => undefined);
    return { port: (server.address() as AddressInfo).port, pid: 1, exited, stop };
  };
};

describe('daemon changes', () => {
  it('a new child that never answers /health is refused after healthMs; the old one runs again', async () => {
    await installed({ launch: silentAt(2), healthMs: 200 });
    const change = await h!.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 'hey' },
    });
    expect(change).toMatchObject({ status: 400, body: { error: { code: 'START_FAILED' } } });
    expect((change.body as { error: { message: string } }).error.message).toContain(
      'health did not answer in 200 ms'
    );
    expect(await echo()).toBe('hi');
  });

  it('two changes at the same time run one after the other; the later one wins', async () => {
    await installed();
    const [a, b] = await Promise.all([
      h!.call('PATCH', '/host/extensions/hosted', { settings: { 'echo.prefix': 'a' } }),
      h!.call('PATCH', '/host/extensions/hosted', { settings: { 'echo.prefix': 'b' } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await echo()).toBe('b hi');
    const settings = JSON.parse(await readFile(join(h!.configDir, 'settings.json'), 'utf8'));
    expect(settings).toEqual({ hosted: { 'echo.prefix': 'b' } });
  });

  it('a secret name that is not a plain token, or not declared, is 400 and writes no file', async () => {
    await installed();
    const escape = `../escaped-${process.pid}-${Date.now()}`;
    for (const name of [escape, 'a/b', 'a.b', 'other']) {
      const refused = await h!.call('PATCH', '/host/extensions/hosted', {
        secrets: { [name]: 'v' },
      });
      expect([name, refused.status]).toEqual([name, 400]);
    }
    expect(await readdir(tmpdir())).not.toContain(escape.slice(3));
    const all = JSON.parse(await readFile(join(h!.configDir, 'secrets.json'), 'utf8'));
    expect(all).toEqual({ hosted: { 'api-token': 't' } });
  });

  it('a PATCH of a failed extension that fails to start is 400 START_FAILED, as for a running one', async () => {
    h = await startHarness();
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    const change = await h.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 'hey' },
    });
    expect(change).toMatchObject({ status: 400, body: { error: { code: 'START_FAILED' } } });
    const list = (await h.call('GET', '/host/extensions')).body;
    expect(list).toMatchObject({ data: [{ id: 'hosted', state: 'failed' }] });
  });

  it('a disabled extension that fails to start with enabled: true stays disabled', async () => {
    h = await startHarness();
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    await h.call('PATCH', '/host/extensions/hosted', { enabled: false });
    const change = await h.call('PATCH', '/host/extensions/hosted', { enabled: true });
    expect(change).toMatchObject({ status: 400, body: { error: { code: 'START_FAILED' } } });
    const list = (await h.call('GET', '/host/extensions')).body;
    expect(list).toMatchObject({ data: [{ id: 'hosted', state: 'disabled', enabled: false }] });
  });
});
