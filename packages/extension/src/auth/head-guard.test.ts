import { Router, type Request, type Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { type ApiContext } from '../api/routes.js';
import { createApiApp } from '../server/app.js';
import { mountApi } from '../server/api-routes.js';
import { createTestContext } from '../context/test-context.js';
import { startTestServer, type TestServer } from '../testing/test-server.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { callerOf, type Access, type Caller, type TokenCheck } from './token-check.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-05T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'probe', parts: { api: true } } };
const ADMIN = { security: [{ pat: ['probe:admin'] }] };
const OPENAPI = {
  openapi: '3.1.0',
  paths: { '/api/probe/wipe': { get: ADMIN }, '/api/probe/echo': { get: { security: [] } } },
};

let server: TestServer | Served | undefined;
afterEach(async () => server?.close());

let runs = 0;
const create = (ctx: ApiContext) => {
  ctx.route('get', '/secret', { summary: 's', scope: 'admin' }, () => (runs += 1));
  ctx.route('get', '/open', { summary: 'o', scope: 'public' }, () => 1);
};

const head = async (caller: Caller | null, path = '/api/test/secret') => {
  runs = 0;
  const s = (server = await startTestServer({ create, caller }));
  const res = await s.fetch(path, { method: 'HEAD' });
  await s.close();
  server = undefined;
  return [res.status, runs];
};

const asker = () => {
  const asked: Access[] = [];
  const check: TokenCheck = async (_authorization, access) => {
    asked.push(access);
    return { sub: 'usr_1', scopes: ['probe:admin'] };
  };
  return { asked, check };
};

const routerApp = async (check: TokenCheck) => {
  const router = Router();
  router.get(['/wipe', '/echo'], (_req: Request, res: Response) => void res.json({ ok: 1 }));
  const base = { pkg: PKG, build: BUILD, log: recordedLog().log, openapi: OPENAPI };
  const app = createApiApp({ ...base, router, tokenCheck: check });
  return (server = await serveApp(app));
};

describe('a HEAD request gets the token check of its GET route', () => {
  it('ctx.route: anonymous 401, a read token 403, an admin token 200, a public route 200', async () => {
    expect(await head(null)).toEqual([401, 0]);
    expect(await head({ sub: 'u_1', scopes: ['test:read'] })).toEqual([403, 0]);
    expect(await head({ sub: 'u_1', scopes: ['test:admin'] })).toEqual([200, 1]);
    expect((await head(null, '/api/test/open'))[0]).toBe(200);
  });

  it('a router part asks for the access the GET operation declares', async () => {
    const { asked, check } = asker();
    const s = await routerApp(check);
    for (const path of ['/api/probe/wipe', '/api/probe/echo'])
      await fetch(`${s.url}${path}`, { method: 'HEAD' });
    expect(asked).toEqual(['admin', 'public']);
  });

  it('ctx.files: a HEAD needs write, as any request that is not a clone or a fetch', async () => {
    const files = (ctx: ApiContext) => ctx.files((_req: Request, res: Response) => res.json(1));
    const caller = { sub: 'u', scopes: ['test:read'] };
    const s = (server = await startTestServer({ create: files, caller }));
    const at = '/files/test/u/default.git/info/refs?service=git-upload-pack';
    expect((await s.fetch(at)).status).toBe(200);
    expect((await s.fetch(at, { method: 'HEAD' })).status).toBe(403);
  });
});

describe('a scoped ctx.route handler runs only for a request the guard checked', () => {
  const app = async (check?: TokenCheck, listed = '/secret') => {
    const ctx = { ...createTestContext(), auth: { caller: callerOf } };
    const mounted = await mountApi(ctx, (api) => create({ ...ctx, ...api }));
    const routes = [{ method: 'get', path: listed }];
    const base = { pkg: PKG, build: BUILD, log: recordedLog().log, router: mounted.router };
    return (server = await serveApp(createApiApp({ ...base, routes, tokenCheck: check })));
  };

  it('a request the guard did not match is 401 and the handler does not run', async () => {
    runs = 0;
    const s = await app(asker().check, '/other');
    expect((await fetch(`${s.url}/api/probe/secret`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/probe/open`)).status).toBe(200);
    expect(runs).toBe(0);
  });

  it('a host with no token check (the local daemon) still runs it', async () => {
    runs = 0;
    const s = await app();
    expect((await fetch(`${s.url}/api/probe/secret`, { method: 'HEAD' })).status).toBe(200);
    expect(runs).toBe(1);
  });
});
