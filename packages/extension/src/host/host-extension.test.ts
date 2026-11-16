import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOn } from '../testing/test-server.js';
import { HOSTED_MANIFEST, hostedPackage } from '../test-support/hosted-fixture.js';
import { rawRequest, serveApp } from '../test-support/http.js';
import { json, tempDir, tempPackage } from '../test-support/packages.js';
import { DATA_DIR_LOCKED } from './data-lock.js';
import { hostExtension, type HostedExtension } from './host-extension.js';

const SECRETS = { 'api-token': 'tok-123' };
const hosted: HostedExtension[] = [];
const host = async (...args: Parameters<typeof hostExtension>) => {
  const one = await hostExtension(...args);
  hosted.push(one);
  return one;
};
// A folder that does not exist yet, as the daemon's data/<id> on a first start.
const dataDir = async () => join(await tempDir('agentage-host-data-'), 'data', 'hosted');

afterEach(async () => {
  await Promise.all(hosted.splice(0).map((h) => h.stop()));
  vi.restoreAllMocks();
});

const statusOf = async (url: string, headers: Record<string, string>, path = '/api/hosted/echo') =>
  (await rawRequest(Number(new URL(url).port), headers, path)).status;

describe('hostExtension', () => {
  it('localOnly mounts the guard of the daemon: Host, Origin and Sec-Fetch-Site', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const opts = { dataDir: '', secrets: SECRETS, localOnly: true };
    const served = await serveApp((await host(await hostedPackage(), opts)).app);
    const at = served.url.slice('http://'.length);
    try {
      expect(await statusOf(served.url, { host: at })).toBe(200);
      expect(await statusOf(served.url, { host: at.replace('127.0.0.1', 'localhost') })).toBe(200);
      expect(await statusOf(served.url, { host: at.replace('127.0.0.1', '[::1]') })).toBe(403);
      expect(await statusOf(served.url, { host: 'evil.example' })).toBe(403);
      expect(await statusOf(served.url, { host: at, origin: 'https://evil.example' })).toBe(403);
      expect(await statusOf(served.url, { host: at, 'sec-fetch-site': 'cross-site' })).toBe(403);
      expect(await statusOf(served.url, { host: at, origin: 'null' })).toBe(403);
      expect(await statusOf(served.url, { host: 'evil.example' }, '/health')).toBe(403);
      expect(await statusOf(served.url, { host: at }, '/health')).toBe(200);
      const open = await serveApp(
        (await host(await hostedPackage(), { ...opts, localOnly: false })).app
      );
      expect(await statusOf(open.url, { host: 'evil.example' })).toBe(200);
      await open.close();
    } finally {
      await served.close();
    }
  });

  it('hosts the api at /api/{id}/* with no token, settings over defaults, the secret, the store', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const opts = { dataDir: await dataDir(), settings: { 'echo.prefix': 'hey' }, secrets: SECRETS };
    const h = await host(await hostedPackage(), { ...opts, origin: 'http://127.0.0.1:4243' });
    expect([h.id, h.version]).toEqual(['hosted', '1.0.0']);
    const server = await startOn(h.app);
    const echo = await (await server.fetch('/api/hosted/echo?msg=hi')).json();
    const data = { msg: 'hey hi', hits: 1, secret: 7, origin: 'http://127.0.0.1:4243' };
    expect(echo).toMatchObject({ success: true, data });
    expect((await server.fetch('/api/v1/echo?msg=hi')).status).toBe(404);
    const health = (await h.health()).data;
    expect(health).toMatchObject({ status: 'ok', checks: { store: 'ok' } });
    const served = (await (await server.fetch('/health')).json()) as { data: { instance: string } };
    expect(served.data.instance).toBe(health.instance);
    const rows = vi.mocked(process.stderr.write).mock.calls.map(([l]) => JSON.parse(String(l)));
    expect(rows.find((r) => r.kind === 'http')).toMatchObject({ extension: 'hosted' });
    await server.close();
  });

  it('stop closes the store and frees dataDir: a second host opens it, writes, sees the rows', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dir = await hostedPackage();
    const opts = { dataDir: await dataDir(), secrets: SECRETS };
    const first = await hostExtension(dir, opts);
    const a = await startOn(first.app);
    await a.fetch('/api/hosted/echo');
    await first.stop();
    expect((await a.fetch('/api/hosted/echo')).status).toBe(500);
    await a.close();
    const b = await startOn((await host(dir, opts)).app);
    expect(await (await b.fetch('/api/hosted/echo')).json()).toMatchObject({ data: { hits: 2 } });
    await b.close();
  });

  it('a second host on an open dataDir fails fast with DATA_DIR_LOCKED; the lock names the pid', async () => {
    const dir = await hostedPackage();
    const opts = { dataDir: await dataDir(), secrets: SECRETS };
    await host(dir, opts);
    expect(await readFile(`${opts.dataDir}.lock`, 'utf8')).toBe(String(process.pid));
    await expect(hostExtension(dir, opts)).rejects.toMatchObject({ code: DATA_DIR_LOCKED });
  });

  it('ctx.exit() calls onExit once, after the handler went on, and never signals the process', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const seen: unknown[] = [];
    const onExit = vi.fn(() => seen.push((globalThis as { afterExit?: boolean }).afterExit));
    const h = await host(await hostedPackage(), { dataDir: '', secrets: SECRETS, onExit });
    const server = await startOn(h.app);
    expect(await (await server.fetch('/api/hosted/exit')).json()).toMatchObject({ data: 'bye' });
    await server.fetch('/api/hosted/exit');
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([true]);
    expect(kill).not.toHaveBeenCalled();
    await server.close();
  });

  it('refuses a start without a secret, a setting of the wrong type, or a failing migration', async () => {
    const dir = await hostedPackage();
    await expect(hostExtension(dir, { dataDir: '' })).rejects.toThrow(
      'api refused to start: secret api-token has no value'
    );
    const wrong = { dataDir: '', secrets: SECRETS, settings: { 'echo.prefix': 3 } };
    await expect(hostExtension(dir, wrong)).rejects.toThrow('setting echo.prefix: 3');
    const broken = await tempPackage({
      'package.json': json(HOSTED_MANIFEST),
      'migrations/001-bad.sql': 'select * from missing;',
    });
    const data = await dataDir();
    const opts = { dataDir: data, secrets: SECRETS };
    await expect(hostExtension(broken, opts)).rejects.toThrow('migration 001-bad.sql failed');
    await expect(readFile(`${data}.lock`)).rejects.toThrow('ENOENT');
  });
});
