import { type Server, type ServerResponse } from 'node:http';
import express from 'express';
import { errorHandler } from '@agentage/extension/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudDiscovery } from './cloud-discovery.js';
import { cloudHealth } from './cloud-health.js';
import { startCloudHost } from './cloud-host.js';
import { type Entries } from './entries.js';
import {
  callAt,
  closeUpstreams,
  cloudEnv,
  docOf,
  quietLog,
  upstream,
} from './test-support/cloud-start.js';

const ROW = { extensions: [{ id: 'fixture' }] };
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
  closeUpstreams();
});

const startAt = async (address: string, drainMs?: number) => {
  const env = await cloudEnv({ ...ROW, upstreams: [{ id: 'fixture', address }] });
  const discovery = { readMs: 5_000, everyMs: 60_000 };
  const host = await startCloudHost(env, { log: quietLog(), discovery, drainMs });
  stop = host.stop;
  return host;
};

const status = async (port: number) => {
  const res = await callAt(port, '/health');
  return [res.status, res.headers['retry-after']];
};

describe('/health readiness of a cloud host', () => {
  it('is 503 while the first pass waits on a slow upstream, then 200', async () => {
    const up = await upstream(docOf('fixture'));
    const held: ServerResponse[] = [];
    up.custom = (_req, res) => (held.push(res), true);
    const { port } = await startAt(up.address);
    await vi.waitFor(() => expect(held.length).toBe(1));
    expect(await status(port)).toEqual([503, '1']);
    held.forEach((res) => res.writeHead(404).end());
    await vi.waitFor(async () => expect((await status(port))[0]).toBe(200));
  });

  it('is 200 after the first pass when every upstream is down', async () => {
    const up = await upstream(docOf('fixture'));
    const address = up.address;
    up.server.close();
    const { port } = await startAt(address);
    await vi.waitFor(async () => expect((await status(port))[0]).toBe(200));
  });

  it('is 503 while draining, even when ready', async () => {
    const up = await upstream(docOf('fixture'));
    const host = await startAt(up.address, 200);
    await vi.waitFor(async () => expect((await status(host.port))[0]).toBe(200));
    const draining = host.drain();
    expect(await status(host.port)).toEqual([503, '1']);
    await draining;
    stop = undefined;
  });

  it('is 200 when the first pass throws', async () => {
    const entries = {
      values: () => {
        throw new Error('pass broke');
      },
    } as unknown as Entries;
    const installation = { host: 'site', extensions: [{ id: 'fixture', version: '1.0.0' }] };
    const d = createCloudDiscovery({
      installation,
      entries,
      own: 'https://platform-host.next.agentage.io',
      log: quietLog(),
      onChange: vi.fn(),
    });
    const build = { version: '1', commit: 'c', buildTime: 't' };
    const app = express().get(
      '/health',
      cloudHealth('site', { build }, () => false, d.ready)
    );
    app.use(errorHandler(quietLog()));
    const server = await new Promise<Server>((up) => {
      const s = app.listen(0, '127.0.0.1', () => up(s));
    });
    stop = () => new Promise((done) => server.close(() => done()));
    const { port } = server.address() as { port: number };
    const get = async () => (await fetch(`http://127.0.0.1:${port}/health`)).status;
    expect(await get()).toBe(503);
    await d.start();
    d.stop();
    expect([d.ready(), await get()]).toEqual([true, 200]);
  });
});
