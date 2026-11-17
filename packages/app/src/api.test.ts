import { describe, expect, it } from 'vitest';
import { AppApiError, callApi, checkApiPath, newAgcid } from './api.js';
import type { HostAdapter } from './app.types.js';

const host = (res: Response, seen: { path?: string; init?: RequestInit } = {}): HostAdapter => ({
  kind: 'local',
  url: 'http://127.0.0.1:4243',
  version: '1.0.0',
  user: null,
  scopes: [],
  request: async (_id, path, init) => {
    Object.assign(seen, { path, init });
    return res;
  },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('checkApiPath', () => {
  it.each(['/echo', '/echo?msg=hi', '/runs/7', '/a.b/c..d', '/find?q=..', '/find?q=../x#..'])(
    'keeps %s',
    (path) => {
      expect(checkApiPath(path)).toBe(path);
    }
  );

  it.each([
    '/../fixture/x',
    '/a/../../x',
    '/%2e%2e/fixture',
    '//evil.example/x',
    'https://evil.example/x',
    'echo',
    '/a\\b',
    '/./x',
    '/%E0%A4%A',
  ])('refuses %s with FORBIDDEN', (path) => {
    expect(() => checkApiPath(path)).toThrow(AppApiError);
    try {
      checkApiPath(path);
    } catch (e) {
      expect((e as AppApiError).code).toBe('FORBIDDEN');
    }
  });
});

describe('callApi', () => {
  it('sends the app header and an agcid, and returns the envelope data', async () => {
    const seen: { path?: string; init?: RequestInit } = {};
    const data = await callApi(
      host(json({ success: true, data: { msg: 'hi' } }), seen),
      'probe',
      '/echo'
    );
    expect(data).toEqual({ msg: 'hi' });
    const headers = new Headers(seen.init?.headers);
    expect(seen.path).toBe('/echo');
    expect(headers.get('X-Agentage-App')).toBe('probe');
    expect(headers.get('agcid')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a body with no envelope as it is', async () => {
    expect(await callApi(host(json({ msg: 'raw' })), 'probe', '/raw')).toEqual({ msg: 'raw' });
  });

  it('throws the envelope error code and status', async () => {
    const res = json({ success: false, error: { code: 'NOT_FOUND', message: 'no run' } }, 404);
    await expect(callApi(host(res), 'probe', '/runs/9')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'no run',
    });
  });

  it('names the status when the body is not JSON', async () => {
    const res = new Response('boom', { status: 502, statusText: 'Bad Gateway' });
    await expect(callApi(host(res), 'probe', '/x')).rejects.toMatchObject({ code: 'HTTP_502' });
  });

  it('never reaches the host with a refused path', async () => {
    const seen: { path?: string } = {};
    await expect(callApi(host(json({}), seen), 'probe', '/../fixture/x')).rejects.toThrow(
      'api path refused'
    );
    expect(seen.path).toBeUndefined();
  });
});

describe('newAgcid', () => {
  it('is a UUIDv7 as 32 hex with the version and variant bits', () => {
    const id = newAgcid();
    expect(id).toMatch(/^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    expect(newAgcid()).not.toBe(id);
  });
});
