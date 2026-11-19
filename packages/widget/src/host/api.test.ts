import { afterEach, describe, expect, it, vi } from 'vitest';
import { controlledTimeout, fakeFetch, hangingFetch, jsonResponse } from '../test-support/fetch.js';
import { callApi, type ApiTarget } from './api.js';
import { type FetchLike, type TokenSource } from './host.types.js';

const anonymous = () => Promise.resolve(undefined);
const withToken = () => Promise.resolve('aga_t');
const to = (fetch: FetchLike, token: TokenSource = anonymous): ApiTarget => ({
  fetch,
  token,
  id: 'probe',
});

afterEach(() => vi.restoreAllMocks());

describe('callApi', () => {
  it('fetches /api/{id}{path} and resolves the envelope data', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ success: true, data: { n: 3 } }));
    await expect(callApi(to(fetch), '/ticks?limit=1')).resolves.toEqual({ n: 3 });
    expect(calls[0]?.url).toBe('/api/probe/ticks?limit=1');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
  });

  it('keeps the caller init and adds the bearer', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ success: true, data: null }));
    const init = { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } };
    await callApi(to(fetch, withToken), '/echo', init);
    const headers = new Headers(calls[0]?.init.headers);
    expect(calls[0]?.init.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer aga_t');
  });

  it('rejects with the error code on success: false', async () => {
    const failure = { success: false, error: { code: 'VALIDATION', message: 'msg is required' } };
    const { fetch } = fakeFetch(jsonResponse(failure, 400));
    await expect(callApi(to(fetch), '/echo')).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'msg is required',
    });
  });

  it('rejects a body that is not an envelope, and a relative path before any fetch', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse('oops', 500, 'text/plain'));
    await expect(callApi(to(fetch), '/echo')).rejects.toMatchObject({
      code: 'HTTP_500',
      message: 'api answered 500',
    });
    await expect(callApi(to(fetch), 'echo')).rejects.toMatchObject({
      code: 'BAD_PATH',
      message: 'api path must start with /: echo',
    });
    expect(calls).toHaveLength(1);
  });

  it('bounds a call at 30 s, also beside a caller signal, and names the path', async () => {
    const { timeout, expire } = controlledTimeout();
    const { fetch, calls, called } = hangingFetch();
    const pending = callApi(to(fetch), '/ticks', { signal: new AbortController().signal });
    await called;
    expect(timeout).toHaveBeenCalledWith(30_000);
    expire();
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: '/api/probe/ticks did not answer in 30 s',
    });
  });

  it('keeps the caller signal, and its abort is not reported as a timeout', async () => {
    controlledTimeout();
    const { fetch, calls, called } = hangingFetch();
    const own = new AbortController();
    const pending = callApi(to(fetch), '/ticks', { signal: own.signal });
    await called;
    own.abort();
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  });
});
