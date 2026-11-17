import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail } from '../envelope/envelope.js';
import { startOn } from '../testing/test-server.js';
import { ALL_PARTS_MANIFEST, allPartsPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { setHostClockRate } from '../worker/clock.js';
import { hostExtension, hostWith, type HostedExtension } from './host-extension.js';

const SECRETS = { 'tick-key': 'k' };
const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const hosted: HostedExtension[] = [];

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await Promise.all(hosted.splice(0).map((h) => h.stop()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const dataDir = async () => join(await tempDir('agentage-host-parts-'), 'data', 'all');

const host = async (opts: Parameters<typeof hostExtension>[1], dir?: string) => {
  const h = await hostExtension(dir ?? (await allPartsPackage()), opts);
  hosted.push(h);
  return { h, server: await startOn(h.app) };
};

const rpc = (method: string, params?: object) => ({
  method: 'POST',
  headers: MCP,
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});

describe('one host process runs every server part', () => {
  it('api at /api/{id}, mcp at /mcp/{id} only, one /health with parts, store and job checks', async () => {
    // Mid-minute: the per-minute tick job must not fire before total 0 is read on a slow runner.
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date().setSeconds(10, 0),
      shouldAdvanceTime: true,
    });
    const { h, server } = await host({ dataDir: await dataDir(), secrets: SECRETS });
    expect(h.parts).toEqual(['api', 'mcp', 'worker']);
    const ticks = await (await server.fetch('/api/all/ticks')).json();
    expect(ticks).toMatchObject({ data: { total: 0, part: 'api' } });
    const list = await (await server.fetch('/mcp/all', rpc('tools/list'))).text();
    expect(list).toContain('"name":"all__echo"');
    const call = rpc('tools/call', { name: 'all__echo', arguments: { msg: 'hi' } });
    expect(await (await server.fetch('/mcp/all', call)).text()).toContain('pong hi');
    expect((await server.fetch('/mcp/all')).status).toBe(405);
    expect((await server.fetch('/mcp', rpc('tools/list'))).status).toBe(404);
    const health = (await (await server.fetch('/health')).json()) as { data: object };
    const checks = { store: 'ok', 'job:tick': 'ok' };
    expect(health.data).toMatchObject({ part: 'api', parts: ['api', 'mcp', 'worker'], checks });
    expect((await h.health()).data).toMatchObject({ parts: ['api', 'mcp', 'worker'] });
    await server.close();
  });

  it('the worker job runs on the minute and writes to the one store', async () => {
    const [dir, data] = [await allPartsPackage(), await dataDir()];
    const minute = new Date();
    // About 1.5 s before the minute: the store opens first, then the job fires on it.
    minute.setSeconds(58, 500);
    vi.useFakeTimers({ toFake: ['Date'], now: minute, shouldAdvanceTime: true });
    const { server } = await host({ dataDir: data, secrets: SECRETS }, dir);
    await vi.waitFor(
      async () => {
        const ticks = await (await server.fetch('/api/all/ticks')).json();
        expect(ticks).toMatchObject({ data: { total: 1 } });
      },
      { timeout: 8000, interval: 100 }
    );
    await server.close();
  });

  it('/health of the host shows the test clock rate when it is not 1', async () => {
    setHostClockRate(60);
    try {
      const { h, server } = await host({ dataDir: '', secrets: SECRETS });
      const health = (await (await server.fetch('/health')).json()) as { data: object };
      expect(health.data).toMatchObject({ clockRate: 60 });
      expect((await h.health()).data).toMatchObject({ clockRate: 60 });
      await server.close();
    } finally {
      setHostClockRate(1);
    }
  });

  it('tools/list stays open with no token check, mcp.listing "token" too', async () => {
    const opts = { dataDir: '', secrets: SECRETS, settings: { 'mcp.listing': 'token' } };
    const { server } = await host(opts);
    expect((await server.fetch('/mcp/all', rpc('tools/list'))).status).toBe(200);
    await server.close();
  });

  it('with a token check (an issuer is set) mcp.listing "token" still needs a token', async () => {
    const tokenCheck = async () => {
      throw fail('UNAUTHORIZED', 'a token is needed');
    };
    const opts = { dataDir: '', secrets: SECRETS, settings: { 'mcp.listing': 'token' } };
    const h = await hostWith(await allPartsPackage(), opts, {
      guard: async () => ({ tokenCheck }),
    });
    hosted.push(h);
    const server = await startOn(h.app);
    expect((await server.fetch('/mcp/all', rpc('tools/list'))).status).toBe(401);
    await server.close();
  });
});

describe('two parts, one check name; a stop while a job runs', () => {
  it('api and mcp both register "shared": the host starts and /health shows the worse', async () => {
    const opts = { dataDir: '', secrets: SECRETS, settings: { 'health.shared': true } };
    const { h, server } = await host(opts);
    const health = (await (await server.fetch('/health')).json()) as { data: object };
    expect(health.data).toMatchObject({ status: 'degraded', checks: { shared: 'degraded' } });
    expect((await h.health()).data.checks).toMatchObject({ shared: 'degraded' });
    await server.close();
  });

  it('stop() while a job runs: no unhandled rejection, the store closes, the lock is freed', async () => {
    const [dir, data] = [await allPartsPackage(), await dataDir()];
    const rejected = vi.fn();
    process.on('unhandledRejection', rejected);
    const minute = new Date();
    minute.setSeconds(58, 500);
    vi.useFakeTimers({ toFake: ['Date'], now: minute, shouldAdvanceTime: true });
    const opts = { dataDir: data, secrets: SECRETS, settings: { 'tick.slow': true } };
    const h = await hostExtension(dir, opts);
    const state = globalThis as { tickRunning?: boolean };
    await vi.waitFor(() => expect(state.tickRunning).toBe(true), { timeout: 8000 });
    await h.stop();
    await expect(readFile(`${data}.lock`)).rejects.toThrow('ENOENT');
    await new Promise((resolve) => setTimeout(resolve, 600));
    process.off('unhandledRejection', rejected);
    expect(rejected).not.toHaveBeenCalled();
    const { server } = await host({ dataDir: data, secrets: SECRETS }, dir);
    // The run that was going when stop() came wrote its row before the store closed.
    const ticks = await server.fetch('/api/all/ticks');
    expect(await ticks.json()).toMatchObject({ data: { total: 1 } });
    await server.close();
  });
});

describe('a part that cannot start stops the host', () => {
  it('a secret of the worker with no value: refused by name, the store closed', async () => {
    const data = await dataDir();
    await expect(hostExtension(await allPartsPackage(), { dataDir: data })).rejects.toThrow(
      'worker refused to start: secret tick-key has no value'
    );
    await expect(readFile(`${data}.lock`)).rejects.toThrow('ENOENT');
  });

  it('a create that throws after the api part: refused, the lock freed, a new host opens it', async () => {
    const data = await dataDir();
    const dir = await allPartsPackage();
    const opts = { dataDir: data, secrets: SECRETS, settings: { 'mcp.fail': true } };
    await expect(hostExtension(dir, opts)).rejects.toThrow('mcp create failed');
    await expect(readFile(`${data}.lock`)).rejects.toThrow('ENOENT');
    const { server } = await host({ dataDir: data, secrets: SECRETS }, dir);
    expect((await server.fetch('/api/all/ticks')).status).toBe(200);
    await server.close();
  });

  it('a package with mcp only runs it at /mcp/{id}, with no store check', async () => {
    const manifest = { ...ALL_PARTS_MANIFEST, agentage: { id: 'all', parts: { mcp: true } } };
    const { h, server } = await host({ dataDir: '' }, await allPartsPackage(manifest));
    expect(h.parts).toEqual(['mcp']);
    expect((await server.fetch('/mcp/all', rpc('tools/list'))).status).toBe(200);
    expect((await server.fetch('/api/all/ticks')).status).toBe(404);
    expect((await h.health()).data.checks).toEqual({});
    await server.close();
  });
});
