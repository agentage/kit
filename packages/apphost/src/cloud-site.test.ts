import { afterEach, describe, expect, it } from 'vitest';
import { PROGRAM_VERSION } from './program-version.js';
import { exchangesOf, fakeAuth, SESSION } from './test-support/cloud-host.js';
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

const ISSUER = { AGENTAGE_ISSUER: 'https://auth.next.agentage.io' };
const BUILD = { VERSION: PROGRAM_VERSION, COMMIT_SHA: 'c'.repeat(40) };

// A pages host: one id, an api container and a pages container (two upstream rows of one id).
const start = async () => {
  const api = await upstream(docOf('site', ['api']));
  const pages = await upstream(docOf('site', ['pages']));
  const auth = fakeAuth();
  const extensions = [{ id: 'site', expose: { api: 'public', pages: 'public' } }];
  const upstreams = [
    { id: 'site', address: api.address },
    { id: 'site', address: pages.address },
  ];
  const env = await cloudEnv({ extensions, upstreams }, { ...ISSUER, ...BUILD });
  host = await startCloud(env, { fetcher: auth.fetcher });
  return { api, pages, auth, call: host.call };
};

describe('the site of a pages host (D81, D82)', () => {
  it('every path that is not reserved goes to the pages container, path, query and method kept', async () => {
    const { pages, api, call } = await start();
    expect((await call('/')).status).toBe(200);
    expect((await call('/blog/a-post?x=1')).status).toBe(200);
    expect((await call('/form', { method: 'POST' })).status).toBe(200);
    expect(pages.seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET /',
      'GET /blog/a-post?x=1',
      'POST /form',
    ]);
    expect(api.seen).toEqual([]);
  });

  it.each(['/health/x', '/api', '/mcp', '/app/site/a.js', '/api/nosuch/x', '/.well-known'])(
    '%s is reserved: 404, the site never sees it',
    async (path) => {
      const { pages } = await start();
      expect((await host!.call(path)).status).toBe(404);
      expect(pages.seen).toEqual([]);
    }
  );

  it('a well-known name goes to the api container, with no token: no exchange, no auth cookie', async () => {
    const { api, pages, auth, call } = await start();
    const headers = { cookie: `${SESSION}; theme=dark`, authorization: 'Bearer eyJ.not.pat' };
    expect((await call('/.well-known/agentage.json', { headers })).status).toBe(200);
    const seen = api.seen.at(-1)!;
    expect([seen.url, seen.headers.authorization, seen.headers.cookie]).toEqual([
      '/.well-known/agentage.json',
      undefined,
      'theme=dark',
    ]);
    expect([exchangesOf(auth), pages.seen]).toEqual([[], []]);
  });

  it.each([
    ['/x/../api/other/y', 404, 'none'],
    ['/x/%2e%2e/api/other/y', 404, 'none'],
    ['/x/%2E%2E/app/site/a.js', 404, 'none'],
    ['/x/../health', 200, 'none'],
    ['/x/%2e%2e/health', 200, 'none'],
    ['/x/../api/site/y', 200, 'api /api/site/y'],
    ['/x/../.well-known/agentage.json', 200, 'api /.well-known/agentage.json'],
    ['/.well-known/%2e%2e/api/site/x', 200, 'api /api/site/x'],
    ['/a/./b/../c?q=1', 200, 'pages /a/c?q=1'],
  ])('dot segments resolve once before routing: %s is %i, reaches %s', async (path, status, to) => {
    const { api, pages, call } = await start();
    expect((await call(path)).status).toBe(status);
    const seen = [
      ...api.seen.map((s) => `api ${s.url}`),
      ...pages.seen.map((s) => `pages ${s.url}`),
    ];
    expect(seen).toEqual(to === 'none' ? [] : [to]);
  });

  it('a pages container that does not answer its discovery: no site route, / is 404', async () => {
    const { pages, call } = await start();
    pages.doc = undefined;
    await host!.refresh();
    expect((await call('/')).status).toBe(404);
    expect(pages.seen).toEqual([]);
  });
});

describe('/.well-known/agentage-router.json', () => {
  it('names the version and commit of the program, no-store; never the site', async () => {
    const { pages, call } = await start();
    const res = await call('/.well-known/agentage-router.json');
    expect([res.status, res.headers['cache-control'], JSON.parse(res.body)]).toEqual([
      200,
      'no-store',
      { version: BUILD.VERSION, commit: BUILD.COMMIT_SHA },
    ]);
    expect((await call('/.well-known/agentage-router.json', { method: 'POST' })).status).toBe(404);
    expect((await call('/.well-known/agentage-host.json', { method: 'POST' })).status).toBe(404);
    expect(pages.seen).toEqual([]);
  });
});
