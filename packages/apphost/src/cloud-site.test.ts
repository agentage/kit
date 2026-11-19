import { afterEach, describe, expect, it } from 'vitest';
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
const BUILD = { VERSION: '0.21.0', COMMIT_SHA: 'c'.repeat(40) };

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

  it('a dot segment cannot take a well-known name out of /.well-known: 400', async () => {
    const { api, call } = await start();
    expect((await call('/.well-known/%2e%2e/api/site/x')).status).toBe(400);
    expect(api.seen).toEqual([]);
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
