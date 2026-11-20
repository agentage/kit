import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudLog } from './cloud-host.js';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  startCloud,
  type Started,
  upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

type Line = { kind?: string; part?: string; agcid?: string; fields?: Record<string, unknown> };

const PUBLIC = { api: 'public', mcp: 'public' };
const KEEP = '0194f2a87c1e7b3a9d405e2f6a1c8b77';
const HEX = /^[0-9a-f]{32}$/;

// A cloud host with one row `echo` (doc undefined: starting); every http line kept.
const startWith = async (doc: unknown) => {
  const up = await upstream(doc);
  const texts: string[] = [];
  const rows = { extensions: [{ id: 'echo', expose: PUBLIC }], upstreams: [] };
  const env = await cloudEnv({ ...rows, upstreams: [{ id: 'echo', address: up.address }] });
  host = await startCloud(env, { log: cloudLog('0.0.0', (text) => texts.push(text)) });
  const http = () =>
    texts.map((t) => JSON.parse(t) as Line).filter((l) => l.kind === 'http' && !isHealth(l));
  return { up, host, http };
};

const isHealth = (l: Line) => l.fields?.['http.route'] === '/health';
const rowOf = (l: Line | undefined) =>
  [l?.part, l?.fields?.['http.request.method'], l?.fields?.['http.route']].concat(
    l?.fields?.['http.response.status_code'] as never
  );

describe('the router request line names its target and itself', () => {
  it('part router, and the route of the matched row id: /api/echo/*, /mcp/echo/*', async () => {
    const { host, http } = await startWith(docOf('echo'));
    await host.call('/api/echo/x?id=42');
    await host.call('/mcp/echo', { method: 'POST' });
    await vi.waitFor(() => expect(http()).toHaveLength(2));
    expect(http().map(rowOf)).toEqual([
      ['router', 'GET', '/api/echo/*', 200],
      ['router', 'POST', '/mcp/echo/*', 200],
    ]);
  });

  it('an id of no row stays (unmatched): a caller id never reaches the route', async () => {
    const { host, http } = await startWith(docOf('echo'));
    expect((await host.call('/api/nosuch-1234/x')).status).toBe(404);
    await vi.waitFor(() => expect(http()).toHaveLength(1));
    expect(rowOf(http()[0])).toEqual(['router', 'GET', '(unmatched)', 404]);
  });

  it('an entry that is starting: the 503 row names its route', async () => {
    const { host, http } = await startWith(undefined);
    expect((await host.call('/api/echo/x', { method: 'POST' })).status).toBe(503);
    await vi.waitFor(() => expect(http()).toHaveLength(1));
    expect(rowOf(http()[0])).toEqual(['router', 'POST', '/api/echo/*', 503]);
  });
});

describe('the router agcid goes upstream', () => {
  it.each([
    ['none sent: the minted one', {}],
    ['a malformed one: the minted one', { agcid: 'not-an-id' }],
    ['a valid one: kept', { agcid: KEEP }],
  ])('%s', async (_why, headers: Record<string, string>) => {
    const { up, host, http } = await startWith(docOf('echo'));
    const answer = await host.call('/api/echo/x', { headers });
    await vi.waitFor(() => expect(http()).toHaveLength(1));
    const sent = up.seen[0]?.headers['agcid'];
    expect(sent).toMatch(HEX);
    expect([http()[0]?.agcid, answer.headers['agcid']]).toEqual([sent, sent]);
    if (headers['agcid'] === KEEP) expect(sent).toBe(KEEP);
  });
});
