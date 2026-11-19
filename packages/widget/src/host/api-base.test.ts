import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse } from '../test-support/fetch.js';
import { callApi, type ApiTarget } from './api.js';
import { type FetchLike } from './host.types.js';

const fail = (status: number, code = 'NOT_FOUND') =>
  jsonResponse({ success: false, error: { code, message: `${code} here` } }, status);
const target = (fetch: FetchLike): ApiTarget => ({
  fetch,
  token: () => Promise.resolve(undefined),
  id: 'probe',
});

describe('callApi base: /api/{id} only, no other base', () => {
  it.each([401, 403, 404, 429, 503])(
    'a %i on /api/{id} is the answer: one call',
    async (status) => {
      const { fetch, calls } = fakeFetch(fail(status), jsonResponse({ success: true, data: 1 }));
      await expect(callApi(target(fetch), '/ticks')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(calls.map((c) => c.url)).toEqual(['/api/probe/ticks']);
    }
  );

  it('a 404 with no envelope is HTTP_404, with no second call', async () => {
    const { fetch, calls } = fakeFetch(new Response('nope', { status: 404 }));
    await expect(callApi(target(fetch), '/ticks')).rejects.toMatchObject({ code: 'HTTP_404' });
    expect(calls).toHaveLength(1);
  });
});
