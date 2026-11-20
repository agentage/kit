import { afterEach, describe, expect, it } from 'vitest';
import { type Session } from './session.js';
import {
  cloudHost,
  exchangesOf,
  type FakeAuth,
  fakeAuth,
  identityReadsOf,
  ISSUER,
  OWN,
  SESSION,
  USER,
} from './test-support/cloud-host.js';

const KEYS = ['host', 'signIn', 'signOut', 'user'];
const SIGN_IN = `${ISSUER}/sign-in?next=${encodeURIComponent(`${OWN}/`)}`;
const PAGE = { 'sec-fetch-site': 'same-origin' };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const start = async (auth: FakeAuth, issuer?: string) => {
  const host = await cloudHost(auth, ...(issuer === undefined ? [] : [issuer]));
  close = host.close;
  const session = async (headers: Record<string, string> = {}) => {
    const res = await host.server.fetch('/shell/session', { headers });
    return [res.status, (await res.json()) as Session] as const;
  };
  const call = (path: string, headers: Record<string, string> = {}) =>
    host.server.fetch(path, { headers }).then(async (res) => (await res.text(), res.status));
  return { ...host, session, call };
};

const accesses = (auth: FakeAuth) =>
  exchangesOf(auth).map((c) => (JSON.parse(c.body) as { access: string }).access);

describe('the cloud session answer (J.4.4 row 2, four keys of J.4.3 row 5)', () => {
  it('signed in: /shell/session names the user from one cached identity read, server-side, no token', async () => {
    const auth = fakeAuth();
    const { session } = await start(auth);
    const cookie = `_ga=1; ${SESSION}`;
    const want = { host: { kind: 'cloud' }, signIn: null, signOut: '/shell/sign-out', user: USER };
    expect(await session({ cookie })).toEqual([200, want]);
    const [, body] = await session({ cookie });
    expect(Object.keys(body).sort()).toEqual(KEYS);
    expect(exchangesOf(auth)).toHaveLength(0);
    const reads = identityReadsOf(auth);
    expect(reads.map((c) => c.url)).toEqual(['/api/auth/get-session']);
    expect(reads[0]!.headers.get('cookie')).toBe(SESSION);
    expect(reads[0]!.headers.get('origin')).toBeNull();
  });

  it('signed out (auth 200 with null): user null and the sign-in link back to this host', async () => {
    const auth = fakeAuth();
    auth.user = null;
    const { session } = await start(auth);
    const want = { host: { kind: 'cloud' }, signIn: SIGN_IN, signOut: null, user: null };
    expect(await session()).toEqual([200, want]);
    expect(await session({ cookie: SESSION })).toEqual([200, want]);
    expect(identityReadsOf(auth)).toHaveLength(1);
  });

  it('no issuer: signed out with no link at all, auth never asked', async () => {
    const auth = fakeAuth();
    const { session } = await start(auth, '');
    const want = { host: { kind: 'cloud' }, signIn: null, signOut: null, user: null };
    expect(await session({ cookie: SESSION })).toEqual([200, want]);
    expect(auth.calls).toHaveLength(0);
  });

  it.each([503, 429, 502])('auth %i is 503, never signed out', async (status) => {
    const auth = fakeAuth();
    auth.identity = status;
    const [code, body] = await (await start(auth)).session({ cookie: SESSION });
    expect([code, (body as unknown as { error: { code: string } }).error.code]).toEqual([
      503,
      'UNAVAILABLE',
    ]);
  });

  it('signOut is offered only to a signed-in cookie session', async () => {
    const auth = fakeAuth();
    const { session } = await start(auth);
    expect((await session({ cookie: SESSION, ...PAGE }))[1].signOut).toBe('/shell/sign-out');
    const bearer = await session({ authorization: 'Bearer oauth-opaque' });
    expect(bearer[1]).toMatchObject({ user: { id: USER.id }, signOut: null });
    expect((await session())[1].signOut).toBeNull();
    auth.user = null;
    expect((await session({ cookie: 'better-auth.session_token=other' }))[1].signOut).toBeNull();
  });

  it('random cookies from one address stop at the router; cached ones and other addresses go on', async () => {
    const auth = fakeAuth();
    auth.user = null;
    const { server } = await start(auth);
    const from = (ip: string, n: number) =>
      server
        .fetch('/shell/session', {
          headers: {
            cookie: `better-auth.session_token=r${n}`,
            'x-forwarded-for': `6.6.6.6, ${ip}`,
          },
        })
        .then(async (res) => (await res.text(), res.status));
    const codes: number[] = [];
    for (let n = 0; n < 31; n++) codes.push(await from('9.9.9.9', n));
    expect([codes.slice(0, 30).every((c) => c === 200), codes[30]]).toEqual([true, 429]);
    expect(await from('9.9.9.9', 0)).toBe(200);
    expect(await from('8.8.8.8', 99)).toBe(200);
    expect(identityReadsOf(auth)).toHaveLength(31);
  });
});

describe('the upstream headers of the cloud session (J.4.4 row 2)', () => {
  it('an api call from the page gets the exchanged bearer and loses the cookie; mcp is unchanged', async () => {
    const auth = fakeAuth();
    const { call, upstream } = await start(auth);
    await call('/api/market/items', { cookie: SESSION, ...PAGE });
    expect(upstream[0]?.authorization).toBe('Bearer aga_market.jwt');
    expect(upstream[0]?.cookie).toBeUndefined();
    expect(JSON.parse(exchangesOf(auth)[0]!.body)).toEqual({
      extension: 'market',
      access: 'admin',
    });
    await call('/mcp/market', { cookie: SESSION });
    expect(upstream[1]?.authorization).toBeUndefined();
  });

  it('a PAT passes as sent; a desktop bearer is exchanged; no credential adds nothing', async () => {
    const auth = fakeAuth();
    const { call, upstream } = await start(auth);
    await call('/api/market/x', { authorization: 'Bearer aga_pat' });
    await call('/api/market/x', { authorization: 'Bearer oauth-opaque' });
    await call('/api/market/x');
    expect(upstream.map((h) => h.authorization)).toEqual([
      'Bearer aga_pat',
      'Bearer aga_market.jwt',
      undefined,
    ]);
    expect(exchangesOf(auth)[0]!.headers.get('authorization')).toBe('Bearer oauth-opaque');
  });

  it('a sibling page under the cookie domain cannot use the session', async () => {
    const auth = fakeAuth();
    const { call, upstream } = await start(auth);
    const origin = await call('/api/market/x', {
      cookie: SESSION,
      origin: 'https://probe.next.agentage.io',
    });
    const site = await call('/api/market/x', { cookie: SESSION, 'sec-fetch-site': 'same-site' });
    expect([origin, site]).toEqual([403, 403]);
    expect(auth.calls.length + upstream.length).toBe(0);
  });

  it('no route forwards the session cookie or a non-PAT bearer: mcp, api with a PAT and a cookie', async () => {
    const { call, upstream } = await start(fakeAuth());
    const both = { cookie: `_ga=1; ${SESSION}`, authorization: 'Bearer aga_pat' };
    await call('/mcp/market', both);
    await call('/mcp/market', { authorization: 'Bearer oauth-opaque' });
    await call('/api/market/x', both);
    expect(upstream.map((h) => [h.cookie, h.authorization])).toEqual([
      ['_ga=1', 'Bearer aga_pat'],
      [undefined, undefined],
      ['_ga=1', 'Bearer aga_pat'],
    ]);
  });

  it('signed out: the api call goes on with no bearer and no session cookie', async () => {
    const { call, upstream } = await start(fakeAuth(() => 401));
    expect(await call('/api/market/x', { cookie: `_ga=1; ${SESSION}`, ...PAGE })).toBe(200);
    expect(upstream[0]).toMatchObject({ cookie: '_ga=1' });
    expect(upstream[0]?.authorization).toBeUndefined();
  });

  it('auth down on an api call is 503, the upstream is not called', async () => {
    const { call, upstream } = await start(fakeAuth(() => 502));
    expect(await call('/api/market/x', { cookie: SESSION, ...PAGE })).toBe(503);
    expect(upstream).toHaveLength(0);
  });

  it('an admin account gets the admin token on an api call, one exchange, cached', async () => {
    const auth = fakeAuth((access) => (access === 'admin' ? 201 : 500));
    const { call, upstream } = await start(auth);
    for (let i = 0; i < 2; i++) await call('/api/market/state', { cookie: SESSION, ...PAGE });
    expect(accesses(auth)).toEqual(['admin']);
    expect(upstream[1]?.authorization).toBe('Bearer aga_market.jwt');
  });

  it('a non-admin falls back to write once; a repeat call is cached for both levels', async () => {
    const auth = fakeAuth((access) => (access === 'admin' ? 403 : 201));
    const { call, upstream } = await start(auth);
    for (let i = 0; i < 2; i++) await call('/api/market/state', { cookie: SESSION, ...PAGE });
    expect(accesses(auth)).toEqual(['admin', 'write']);
    expect(upstream[1]?.authorization).toBe('Bearer aga_market.jwt');
  });
});
