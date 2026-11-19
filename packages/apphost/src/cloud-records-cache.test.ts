import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler, startOn, type TestServer } from '@agentage/extension/internal';
import { recordRoutes, ROOT_RESOURCE } from './cloud-records.js';
import { quietLog } from './test-support/cloud-upstream.js';

const open: (Server | TestServer)[] = [];
afterEach(async () => {
  for (const s of open.splice(0))
    'url' in s ? await s.close() : (s.closeAllConnections(), s.close());
});

// An upstream that answers its resource document with these scopes, or never answers ('hang').
const container = async (scopes: string[] | 'hang') => {
  let reads = 0;
  const server = createServer((_req, res) => {
    reads++;
    if (scopes === 'hang') return;
    res.end(JSON.stringify({ resource: 'x', scopes_supported: scopes }));
  });
  open.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { address, reads: () => reads };
};

// The records handler alone, over a discovery of public rows each served at its address.
const serve = async (at: Record<string, string>, o: Parameters<typeof recordRoutes>[2]) => {
  const extensions = Object.keys(at).map((id) => ({ id, expose: { api: 'public' } }));
  const discovery = {
    current: () => ({ document: { extensions } }) as never,
    servedBy: (id: string) => [at[id] as string],
  };
  const app = express();
  app.use(recordRoutes(discovery, 'https://test.next.agentage.io', o));
  app.use(errorHandler(quietLog()));
  const server = await startOn(app);
  open.push(server);
  return server;
};

describe('the root resource document: time', () => {
  it('requests that come while a read runs share it; the fetcher option is used', async () => {
    const a = await container(['a:read']);
    const fetcher = vi.fn(fetch);
    const server = await serve({ a: a.address }, { fetcher });
    const all = await Promise.all([1, 2, 3].map(() => server.fetch(ROOT_RESOURCE)));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect([a.reads(), fetcher.mock.calls.length]).toEqual([1, 1]);
  });

  it('one slow row drops out after readMs; the others still answer', async () => {
    const [probe, fixture] = [await container('hang'), await container(['fixture:read'])];
    const server = await serve({ probe: probe.address, fixture: fixture.address }, { readMs: 50 });
    const res = await server.fetch(ROOT_RESOURCE);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scopes_supported: string[] }).scopes_supported).toEqual([
      'fixture:read',
    ]);
  });

  it('cached for the ttl, read again after it; a read with a failed row is not cached', async () => {
    let t = 0;
    const probe = await container(['probe:read']);
    const server = await serve({ probe: probe.address }, { ttlMs: 30_000, now: () => t });
    await server.fetch(ROOT_RESOURCE);
    await server.fetch(ROOT_RESOURCE);
    expect(probe.reads()).toBe(1);
    t = 30_000;
    await server.fetch(ROOT_RESOURCE);
    expect(probe.reads()).toBe(2);
    const slow = await container('hang');
    const failing = await serve({ probe: probe.address, slow: slow.address }, { readMs: 50 });
    await failing.fetch(ROOT_RESOURCE);
    await failing.fetch(ROOT_RESOURCE);
    expect(probe.reads()).toBe(4);
  });
});
