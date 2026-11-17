import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse } from '../test-support/fetch.js';
import { callApi, type ApiTarget } from './api.js';
import { type FetchLike } from './host.types.js';

const ok = (data: unknown) => jsonResponse({ success: true, data });
const fail = (status: number, code = 'NOT_FOUND') =>
  jsonResponse({ success: false, error: { code, message: `${code} here` } }, status);
const target = (fetch: FetchLike, id = 'probe'): ApiTarget => ({
  fetch,
  token: () => Promise.resolve(undefined),
  id,
  bases: {},
});
const urls = (calls: { url: string }[]) => calls.map((c) => c.url);

describe('callApi base: /api/{id}, /api/v1 only after a 404 not owned by the route', () => {
  it('calls /api/{id}{path} and pins it on a 2xx', async () => {
    const { fetch, calls } = fakeFetch(ok(1), fail(404));
    const t = target(fetch);
    await expect(callApi(t, '/ticks?limit=1')).resolves.toBe(1);
    // A 404 on a pinned base is the route's own answer: no second call.
    await expect(callApi(t, '/items/7')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(urls(calls)).toEqual(['/api/probe/ticks?limit=1', '/api/probe/items/7']);
    expect(t.bases.pinned).toBe('/api/probe');
  });

  it('a 404 on /api/{id} falls back to /api/v1 once, then pins /api/v1', async () => {
    const { fetch, calls } = fakeFetch(fail(404), ok(2), ok(3));
    const t = target(fetch);
    await expect(callApi(t, '/two')).resolves.toBe(2);
    await expect(callApi(t, '/three')).resolves.toBe(3);
    expect(urls(calls)).toEqual(['/api/probe/two', '/api/v1/two', '/api/v1/three']);
  });

  it.each([400, 401, 403, 422])(
    'a route-owned %i on /api/{id} pins it, no fallback',
    async (status) => {
      const { fetch, calls } = fakeFetch(fail(status, 'REFUSED'), ok(4));
      const t = target(fetch);
      await expect(callApi(t, '/x')).rejects.toMatchObject({ code: 'REFUSED' });
      await expect(callApi(t, '/y')).resolves.toBe(4);
      expect(urls(calls)).toEqual(['/api/probe/x', '/api/probe/y']);
    }
  );

  it('a 5xx neither falls back nor pins', async () => {
    const { fetch, calls } = fakeFetch(fail(503, 'UNAVAILABLE'), ok(5));
    const t = target(fetch);
    await expect(callApi(t, '/x')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(callApi(t, '/x')).resolves.toBe(5);
    expect(urls(calls)).toEqual(['/api/probe/x', '/api/probe/x']);
    expect(t.bases.pinned).toBe('/api/probe');
  });

  it('both 404: the /api/{id} answer stands and nothing is pinned', async () => {
    const { fetch, calls } = fakeFetch(fail(404, 'NO_ITEM'), fail(404, 'NO_ROUTE'));
    const t = target(fetch);
    await expect(callApi(t, '/items/7')).rejects.toMatchObject({ code: 'NO_ITEM' });
    expect(urls(calls)).toEqual(['/api/probe/items/7', '/api/v1/items/7']);
    expect(t.bases.pinned).toBeUndefined();
  });
});
