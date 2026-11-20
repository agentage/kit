import { Router } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../server/app.js';
import { startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { authEnv, partPackage, RESOURCE, startPart, STOP } from '../test-support/part-fixture.js';

let dir: string;
let issuer: TestIssuer;
let served: Served | undefined;
beforeAll(async () => {
  dir = await partPackage();
});
beforeEach(async () => {
  issuer = await startIssuer();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
  served?.close();
  served = undefined;
  await issuer.close();
});

const get = (url: string, headers: Record<string, string> = {}) =>
  fetch(`${url}/api/probe/caller`, { headers });

describe('the caller route of an api part image (real tokens)', () => {
  it('200 for read, write and admin with the own scopes only; 401; 403; a cookie is no token', async () => {
    const url = await startPart(dir, 'api', authEnv(issuer, dir));
    const admin = await issuer.bearer({ scope: 'probe:admin memory:read', sub: 'usr_1' });
    const ok = await get(url, { authorization: admin });
    expect([ok.status, ok.headers.get('cache-control'), await ok.json()]).toEqual([
      200,
      'no-store',
      { success: true, data: { sub: 'usr_1', scopes: ['probe:admin'] } },
    ]);
    const none = await get(url);
    expect([none.status, none.headers.get('www-authenticate')]).toEqual([401, RESOURCE]);
    expect(await none.json()).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    const cookie = await get(url, { cookie: 'agentage.session=x' });
    expect(cookie.status).toBe(401);
    const other = await get(url, { authorization: await issuer.bearer({ scope: 'memory:admin' }) });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('the request line names the route and the caller', async () => {
    const recorded = recordedLog();
    const tokenCheck = async () => ({ sub: 'usr_9', scopes: ['probe:read'] });
    const base = { pkg: API_MANIFEST, build: { commit: SHA, buildTime: '2026-11-20T00:00:00Z' } };
    const app = createApiApp({ ...base, log: recorded.log, router: Router(), tokenCheck });
    served = await serveApp(app);
    expect((await get(served.url)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const row = recorded.lines.find((line) => line['kind'] === 'http');
    expect([row?.['http.route'], row?.['sub'], row?.['http.response.status_code']]).toEqual([
      '/api/probe/caller',
      'usr_9',
      200,
    ]);
  });
});
