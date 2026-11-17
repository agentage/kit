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
    const { fetch, calls } = fakeFetch(ok(1), ok(2));
    const t = target(fetch);
    await expect(callApi(t, '/ticks?limit=1')).resolves.toBe(1);
    await expect(callApi(t, '/items/7')).resolves.toBe(2);
    expect(urls(calls)).toEqual(['/api/probe/ticks?limit=1', '/api/probe/items/7']);
    expect(t.bases.pinned).toBe('/api/probe');
  });

  it('a 404 on a pinned /api/v1 (the host moved to one image) tries /api/{id}, then pins it', async () => {
    const { fetch, calls } = fakeFetch(fail(404), ok(1), fail(404), ok(2), ok(3));
    const t = target(fetch);
    await expect(callApi(t, '/a')).resolves.toBe(1);
    await expect(callApi(t, '/b')).resolves.toBe(2);
    await expect(callApi(t, '/c')).resolves.toBe(3);
    expect(urls(calls)).toEqual([
      '/api/probe/a',
      '/api/v1/a',
      '/api/v1/b',
      '/api/probe/b',
      '/api/probe/c',
    ]);
    expect(t.bases.pinned).toBe('/api/probe');
  });

  it('a 404 on a pinned /api/{id} (the host moved back) tries /api/v1, then pins it', async () => {
    const { fetch, calls } = fakeFetch(ok(1), fail(404), ok(2), ok(3));
    const t = target(fetch);
    await callApi(t, '/a');
    await expect(callApi(t, '/b')).resolves.toBe(2);
    await expect(callApi(t, '/c')).resolves.toBe(3);
    expect(urls(calls)).toEqual(['/api/probe/a', '/api/probe/b', '/api/v1/b', '/api/v1/c']);
    expect(t.bases.pinned).toBe('/api/v1');
  });

  it('a 404 on a pinned base and on the other base: the pinned answer stands, no pin', async () => {
    const { fetch, calls } = fakeFetch(ok(1), fail(404, 'NO_ITEM'), fail(404, 'NO_ROUTE'));
    const t = target(fetch);
    await callApi(t, '/a');
    await expect(callApi(t, '/items/7')).rejects.toMatchObject({ code: 'NO_ITEM' });
    expect(urls(calls)).toEqual(['/api/probe/a', '/api/probe/items/7', '/api/v1/items/7']);
    expect(t.bases.pinned).toBeUndefined();
  });

  it('a bridge with no id keeps /api/v1 on a 404: no other base', async () => {
    const { fetch, calls } = fakeFetch(ok(1), fail(404, 'NO_ITEM'));
    const t: ApiTarget = { ...target(fetch), id: undefined };
    await callApi(t, '/a');
    await expect(callApi(t, '/b')).rejects.toMatchObject({ code: 'NO_ITEM' });
    expect(urls(calls)).toEqual(['/api/v1/a', '/api/v1/b']);
  });

  it('a 404 on /api/{id} falls back to /api/v1 once, then pins /api/v1', async () => {
    const { fetch, calls } = fakeFetch(fail(404), ok(2), ok(3));
    const t = target(fetch);
    await expect(callApi(t, '/two')).resolves.toBe(2);
    await expect(callApi(t, '/three')).resolves.toBe(3);
    expect(urls(calls)).toEqual(['/api/probe/two', '/api/v1/two', '/api/v1/three']);
  });

  it.each([400, 422])('a route envelope on %i pins /api/{id}, no fallback', async (status) => {
    const { fetch, calls } = fakeFetch(fail(status, 'REFUSED'), ok(4));
    const t = target(fetch);
    await expect(callApi(t, '/x')).rejects.toMatchObject({ code: 'REFUSED' });
    await expect(callApi(t, '/y')).resolves.toBe(4);
    expect(urls(calls)).toEqual(['/api/probe/x', '/api/probe/y']);
  });

  it('a 400 that is not an envelope does not pin', async () => {
    const { fetch } = fakeFetch(jsonResponse('bad', 400, 'text/plain'));
    const t = target(fetch);
    await expect(callApi(t, '/x')).rejects.toMatchObject({ code: 'HTTP_400' });
    expect(t.bases.pinned).toBeUndefined();
  });

  it.each([401, 403])(
    'a %i on an unpinned /api/{id} tries /api/v1 once and pins it',
    async (status) => {
      const { fetch, calls } = fakeFetch(fail(status, 'EDGE'), ok(6), ok(7));
      const t = target(fetch);
      await expect(callApi(t, '/x')).resolves.toBe(6);
      await expect(callApi(t, '/y')).resolves.toBe(7);
      expect(urls(calls)).toEqual(['/api/probe/x', '/api/v1/x', '/api/v1/y']);
    }
  );

  it.each([401, 403, 429])('a %i on a pinned base never falls back nor re-pins', async (status) => {
    const { fetch, calls } = fakeFetch(ok(1), fail(status, 'NO'));
    const t = target(fetch);
    await callApi(t, '/a');
    await expect(callApi(t, '/b')).rejects.toMatchObject({ code: 'NO' });
    expect(urls(calls)).toEqual(['/api/probe/a', '/api/probe/b']);
    expect(t.bases.pinned).toBe('/api/probe');
  });

  it('a 429 on an unpinned base neither falls back nor pins', async () => {
    const { fetch, calls } = fakeFetch(fail(429, 'RATE'));
    const t = target(fetch);
    await expect(callApi(t, '/x')).rejects.toMatchObject({ code: 'RATE' });
    expect(urls(calls)).toEqual(['/api/probe/x']);
    expect(t.bases.pinned).toBeUndefined();
  });

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
