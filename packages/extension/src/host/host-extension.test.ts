import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOn } from '../testing/test-server.js';
import { HOSTED_MANIFEST, hostedPackage } from '../test-support/hosted-fixture.js';
import { json, tempPackage } from '../test-support/packages.js';
import { hostExtension, type HostedExtension } from './host-extension.js';

const SECRETS = { 'api-token': 'tok-123' };
const hosted: HostedExtension[] = [];
const host = async (...args: Parameters<typeof hostExtension>) => {
  const one = await hostExtension(...args);
  hosted.push(one);
  return one;
};
const dataDir = () => mkdtemp(join(tmpdir(), 'agentage-host-data-'));

afterEach(async () => {
  await Promise.all(hosted.splice(0).map((h) => h.stop()));
  vi.restoreAllMocks();
});

describe('hostExtension', () => {
  it('hosts the api at /api/{id}/* with no token, settings over defaults, the secret, the store', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dir = await hostedPackage();
    const opts = { dataDir: await dataDir(), settings: { 'echo.prefix': 'hey' }, secrets: SECRETS };
    const h = await host(dir, opts);
    expect([h.id, h.version]).toEqual(['hosted', '1.0.0']);
    const server = await startOn(h.app);
    const echo = await (await server.fetch('/api/hosted/echo?msg=hi')).json();
    expect(echo).toMatchObject({ success: true, data: { msg: 'hey hi', hits: 1, secret: 7 } });
    expect((await server.fetch('/api/v1/echo?msg=hi')).status).toBe(404);
    expect((await h.health()).data).toMatchObject({ status: 'ok', checks: { store: 'ok' } });
    const rows = vi.mocked(process.stderr.write).mock.calls.map(([l]) => JSON.parse(String(l)));
    expect(rows.find((r) => r.kind === 'http')).toMatchObject({ extension: 'hosted' });
    await server.close();
  });

  it('keeps the store in dataDir: a second host of the same folder sees the rows', async () => {
    const dir = await hostedPackage();
    const opts = { dataDir: await dataDir(), secrets: SECRETS };
    const first = await host(dir, opts);
    const a = await startOn(first.app);
    await a.fetch('/api/hosted/echo');
    await a.close();
    await first.stop();
    const b = await startOn((await host(dir, opts)).app);
    expect(await (await b.fetch('/api/hosted/echo')).json()).toMatchObject({ data: { hits: 2 } });
    await b.close();
  });

  it('ctx.exit() calls onExit once the answer is sent and never signals the process', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const onExit = vi.fn();
    const h = await host(await hostedPackage(), { dataDir: '', secrets: SECRETS, onExit });
    const server = await startOn(h.app);
    expect(await (await server.fetch('/api/hosted/exit')).json()).toMatchObject({ data: 'bye' });
    await server.fetch('/api/hosted/exit');
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
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
    await expect(hostExtension(broken, { dataDir: '', secrets: SECRETS })).rejects.toThrow(
      'migration 001-bad.sql failed'
    );
  });

  it('a package without an api part (mcp only) serves /health only; without a store it has no store check', async () => {
    const manifest = { ...HOSTED_MANIFEST, agentage: { id: 'bare', parts: { mcp: true } } };
    const h = await host(await tempPackage({ 'package.json': json(manifest) }), { dataDir: '' });
    const server = await startOn(h.app);
    expect((await server.fetch('/health')).status).toBe(200);
    expect((await server.fetch('/api/bare/echo')).status).toBe(404);
    expect((await h.health()).data.checks).toEqual({});
    await server.close();
  });
});
