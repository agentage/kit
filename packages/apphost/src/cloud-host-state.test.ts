import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  openFeed,
  startCloud,
  startWithShell,
  type Started,
  upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const PUBLIC = { api: 'public', mcp: 'public' };

const stateOf = async (h: Started, id: string) => {
  const doc = JSON.parse((await h.call('/.well-known/agentage-host.json')).body) as {
    kind: string;
    extensions: { id: string; state: string }[];
  };
  return [doc.kind, doc.extensions.find((e) => e.id === id)?.state];
};

describe('one source of state: the discovery documents of the upstream rows (F-c)', () => {
  it('an upstream whose /health is 500 but whose document is good is running and routed; its /health is never read', async () => {
    const up = await upstream(docOf('echo'));
    up.health = 500;
    const rows = {
      extensions: [{ id: 'echo', expose: PUBLIC }],
      upstreams: [{ id: 'echo', address: up.address }],
    };
    host = await startCloud(await cloudEnv(rows));
    expect(await stateOf(host, 'echo')).toEqual(['cloud', 'running']);
    expect((await host.call('/api/echo/hi')).status).toBe(200);
    expect(up.healthReads).toBe(0);
  });

  it('an upstream whose /health is 200 but with no document is starting: 503, never routed', async () => {
    const up = await upstream(undefined);
    const rows = {
      extensions: [{ id: 'echo', expose: PUBLIC }],
      upstreams: [{ id: 'echo', address: up.address }],
    };
    host = await startCloud(await cloudEnv(rows));
    expect(await stateOf(host, 'echo')).toEqual(['cloud', 'starting']);
    const res = await host.call('/api/echo/hi');
    expect([res.status, res.headers['retry-after'], up.seen, up.healthReads]).toEqual([
      503,
      '5',
      [],
      0,
    ]);
  });

  it('a document that goes bad after an answer is down; the shell feed is told of each change', async () => {
    const up = await upstream(docOf('echo'));
    const rows = {
      extensions: [{ id: 'echo', expose: PUBLIC }],
      upstreams: [{ id: 'echo', address: up.address }],
    };
    host = await startWithShell(rows);
    const feed = await openFeed(host.port);
    up.doc = { id: 'echo' };
    await host.refresh();
    expect(await stateOf(host, 'echo')).toEqual(['cloud', 'down']);
    await vi.waitFor(() => expect(feed.chunks.join('')).toContain('event: extensions'));
    feed.close();
  });
});
