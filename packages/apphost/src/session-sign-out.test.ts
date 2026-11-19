import { afterEach, describe, expect, it } from 'vitest';
import { clearsOf } from './cloud-sign-out.js';
import {
  CLEARS,
  cloudHost,
  exchangesOf,
  type FakeAuth,
  fakeAuth,
  ISSUER,
  OWN,
  SESSION,
} from './test-support/cloud-host.js';

const PAGE = { cookie: `_ga=1; ${SESSION}`, 'sec-fetch-site': 'same-origin', origin: OWN };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const start = async (auth: FakeAuth) => {
  const host = await cloudHost(auth, 'platform');
  close = host.close;
  const session = (headers: Record<string, string> = PAGE) =>
    host.server
      .fetch('/shell/session', { headers })
      .then((res) => res.json() as Promise<{ user: { id: string } | null }>);
  const signOut = (headers: Record<string, string> = PAGE) =>
    host.server.fetch('/shell/sign-out', { method: 'POST', headers });
  const api = (headers: Record<string, string> = PAGE) =>
    host.server.fetch('/api/market/x', { headers }).then((res) => res.text());
  return { ...host, session, signOut, api };
};

const signOutCall = (auth: FakeAuth) => auth.calls.find((c) => c.url === '/api/auth/sign-out');

describe('the cloud sign-out (J.4.4 row 2)', () => {
  it('after sign-out the cached tokens are gone: the next calls ask auth again', async () => {
    const auth = fakeAuth();
    const { session, signOut, api, upstream } = await start(auth);
    await api();
    expect((await session()).user?.id).toBe('u1');
    expect(upstream[0]?.authorization).toBe('Bearer aga_market.jwt');
    expect((await signOut()).status).toBe(200);
    auth.exchange = () => 401;
    expect((await session()).user).toBeNull();
    await api();
    expect(upstream[1]?.authorization).toBeUndefined();
    expect(exchangesOf(auth)).toHaveLength(4);
  });

  it('the sign-out at auth carries the auth Origin and only the session cookies; both clears reach the browser', async () => {
    const auth = fakeAuth();
    const { signOut } = await start(auth);
    const res = await signOut();
    expect(await res.json()).toEqual({ success: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.getSetCookie()).toEqual(CLEARS);
    const call = signOutCall(auth)!;
    expect([call.headers.get('origin'), call.headers.get('cookie'), call.body]).toEqual([
      ISSUER,
      SESSION,
      '{}',
    ]);
  });

  it('a sibling page cannot sign the user out: 403 and no call to auth', async () => {
    const auth = fakeAuth();
    const { signOut } = await start(auth);
    const origin = await signOut({ cookie: SESSION, origin: 'https://probe.next.agentage.io' });
    const site = await signOut({ cookie: SESSION, 'sec-fetch-site': 'same-site' });
    expect([origin.status, site.status]).toEqual([403, 403]);
    expect(auth.calls).toHaveLength(0);
  });

  it('no session cookie: 200 and no call to auth; auth saying 401 (already signed out) is 200 and the cookie is cleared', async () => {
    const auth = fakeAuth();
    const { signOut } = await start(auth);
    expect([
      (await signOut({ 'sec-fetch-site': 'same-origin' })).status,
      auth.calls.length,
    ]).toEqual([200, 0]);
    auth.signOut = 401;
    const res = await signOut();
    expect(res.status).toBe(200);
    expect(
      res.headers.getSetCookie().some((c) => /^better-auth\.session_token=;.*Max-Age=0/i.test(c))
    ).toBe(true);
  });

  it('auth refusing with another 4xx (403): the auth status reaches the shell, the cookie is cleared, the cache is dropped', async () => {
    const auth = fakeAuth();
    const { session, signOut } = await start(auth);
    await session();
    auth.signOut = 403;
    const res = await signOut();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect([body.success, body.error.code]).toEqual([false, 'SIGN_OUT_REFUSED']);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const clear = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('better-auth.session_token='));
    expect(clear).toMatch(/Max-Age=0/);
    await session();
    expect(exchangesOf(auth)).toHaveLength(2);
  });

  it('auth down at sign-out: 503, and the cache is dropped all the same', async () => {
    const auth = fakeAuth();
    const { session, signOut } = await start(auth);
    await session();
    auth.signOut = 500;
    const res = await signOut();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAVAILABLE');
    await session();
    expect(exchangesOf(auth)).toHaveLength(2);
  });

  it('auth unreachable or 429 at sign-out is 503', async () => {
    const auth = fakeAuth();
    const { signOut } = await start(auth);
    auth.signOut = 429;
    expect((await signOut()).status).toBe(503);
    auth.down = true;
    expect((await signOut()).status).toBe(503);
  });

  it('the synthetic clear carries the parent domain of a named issuer host', () => {
    const [named] = clearsOf(SESSION, 'https://auth.agentage.io');
    expect(named).toMatch(/Max-Age=0; Path=\/; Secure; HttpOnly.*Domain=\.agentage\.io/);
    expect(clearsOf(SESSION, 'http://127.0.0.1:9')[0]).not.toMatch(/Domain=/);
    expect(
      clearsOf('__Host-better-auth.session_token=x', 'https://auth.agentage.io')[0]
    ).not.toMatch(/Domain=/);
  });
});
