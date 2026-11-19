import { afterEach, describe, expect, it } from 'vitest';
import { json, startStub, type Handler } from '../test-support/core-stub.js';
import { createCoreClient } from './core-client.js';

const SHA = 'a'.repeat(40);
const LATEST = { id: 'probe', version: '1.2.3', commit: SHA, package: '@agentage/extension-probe' };

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

const serve = async (routes: Record<string, Handler>) => {
  const stub = await startStub((req, res) => {
    const route = routes[req.url ?? ''];
    if (route) route(req, res);
    else json(404, { success: false, error: { code: 'NOT_FOUND' } })(req, res);
  });
  stops.push(stub.close);
  return stub;
};

describe('core-client market.latest', () => {
  it('the newest version, its package and commit', async () => {
    const stub = await serve({
      '/api/market/extensions/probe/latest': json(200, { data: LATEST }),
    });
    const answer = await createCoreClient({ url: stub.url }).market.latest('probe');
    expect(answer).toEqual({ data: LATEST, down: null });
  });

  it('a 404 on both paths is no such id, not "not reachable"', async () => {
    const stub = await serve({});
    const client = createCoreClient({ url: stub.url });
    expect(await client.market.latest('nope')).toEqual({ data: null, down: null });
    expect(client.down()).toBeNull();
    expect(stub.hits).toEqual([
      'GET /api/market/extensions/nope/latest',
      'GET /api/v1/extensions/nope/latest',
    ]);
  });

  it('the v13 path answers when the one-image path is missing, and stays chosen', async () => {
    const stub = await serve({ '/api/v1/extensions/probe/latest': json(200, { data: LATEST }) });
    const client = createCoreClient({ url: stub.url });
    await client.market.latest('probe');
    expect((await client.market.latest('probe')).data?.version).toBe('1.2.3');
    expect(stub.hits.filter((h) => h.includes('/api/market/'))).toHaveLength(1);
  });

  it.each([
    ['a version that is not exact', { ...LATEST, version: '^1.0.0' }],
    ['a package of another id', { ...LATEST, package: 'evil' }],
  ])('refuses %s', async (_name, data) => {
    const stub = await serve({ '/api/market/extensions/probe/latest': json(200, { data }) });
    const answer = await createCoreClient({ url: stub.url }).market.latest('probe');
    expect(answer).toMatchObject({ data: null, down: { code: 'refused' } });
  });

  it('a commit that is not 40 hex is null', async () => {
    const data = { ...LATEST, commit: 'abc' };
    const stub = await serve({ '/api/market/extensions/probe/latest': json(200, { data }) });
    const answer = await createCoreClient({ url: stub.url }).market.latest('probe');
    expect(answer.data?.commit).toBeNull();
  });

  it('a redirect is not the answer', async () => {
    const stub = await serve({
      '/api/market/extensions/probe/latest': (_req, res) => {
        res.writeHead(302, { location: 'https://sign-in.example' });
        res.end();
      },
    });
    const answer = await createCoreClient({ url: stub.url }).market.latest('probe');
    expect(answer.down?.detail).toContain('answered 302 to https://sign-in.example');
  });

  it('down keeps the first reason', async () => {
    const stub = await serve({ '/api/market/extensions/a/latest': json(500, {}) });
    const client = createCoreClient({ url: stub.url });
    const first = (await client.market.latest('a')).down;
    await createCoreClient({ url: stub.url }).market.latest('b');
    await client.market.list();
    expect(client.down()).toBe(first);
  });
});

describe('core-client market.list', () => {
  const page = (data: unknown[], nextCursor?: string) =>
    json(200, { data, meta: { pagination: { limit: 200, ...(nextCursor && { nextCursor }) } } });

  it('follows meta.pagination.nextCursor and asks /latest for a row with no version', async () => {
    const stub = await serve({
      '/api/market/extensions?limit=200': page([{ id: 'a', version: '1.0.0' }], 'YQ'),
      '/api/market/extensions?limit=200&cursor=YQ': page([{ id: 'probe', version: null }]),
      '/api/market/extensions/probe/latest': json(200, { data: LATEST }),
    });
    const answer = await createCoreClient({ url: stub.url }).market.list();
    expect(answer).toEqual({
      data: {
        offered: [
          { id: 'a', version: '1.0.0' },
          { id: 'probe', version: '1.2.3' },
        ],
        skipped: [],
      },
      down: null,
    });
  });

  it('a row whose /latest fails is skipped with its reason; the listing stays up', async () => {
    const stub = await serve({
      '/api/market/extensions?limit=200': page([{ id: 'b', version: null }, { id: 'c' }]),
      '/api/market/extensions/b/latest': json(500, {}),
    });
    const client = createCoreClient({ url: stub.url });
    const answer = await client.market.list();
    expect(answer.down).toBeNull();
    expect(answer.data.skipped).toEqual([
      { id: 'b', reason: expect.stringContaining('answered 500') as string },
      { id: 'c', reason: 'the market has no version of it' },
    ]);
    expect(client.down()).toBeNull();
  });

  it('no list route on either path is not reachable', async () => {
    const stub = await serve({});
    const answer = await createCoreClient({ url: stub.url }).market.list();
    expect(answer).toMatchObject({ data: { offered: [], skipped: [] }, down: { code: 'failed' } });
  });
});

// Only the market's 404 reads as "no such id": a 2xx without the answer is a reason.
describe('core-client a 2xx that is not the answer', () => {
  it.each([
    [
      'latest',
      '/api/market/extensions/probe/latest',
      (u: string) => createCoreClient({ url: u }).market.latest('probe'),
    ],
    [
      'list',
      '/api/market/extensions?limit=200',
      (u: string) => createCoreClient({ url: u }).market.list(),
    ],
  ] as const)('%s with no data is refused, not empty', async (_name, path, call) => {
    for (const body of [{}, { data: null }]) {
      const stub = await serve({ [path]: json(200, body) });
      expect((await call(stub.url)).down).toMatchObject({ code: 'refused' });
    }
  });
});
