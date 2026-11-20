import { describe, expect, it } from 'vitest';
import { keyOf } from './auth-exchange.js';
import { createIdentityRead } from './auth-identity-cache.js';
import { askIdentity } from './auth-identity.js';

const ISSUER = 'https://auth.next.agentage.io';
const TOKEN = 's1.sig';
const COOKIE = { cookie: `better-auth.session_token=${TOKEN}` };
const BEARER = { authorization: 'Bearer oauth-opaque' };

const answering = (status: number, body: unknown, seen: RequestInit[] = []): typeof fetch =>
  (async (_url: string, init: RequestInit) => {
    seen.push(init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

const ask = (fetcher: typeof fetch, credential: { cookie: string } | { authorization: string }) =>
  askIdentity({ issuer: ISSUER, fetcher, timeoutMs: 100 }, credential);

describe('askIdentity: one read at auth, no extension id', () => {
  it('reads the cookie session and the bearer row; no Origin, no redirect follow', async () => {
    const seen: RequestInit[] = [];
    const ends = '2030-01-01T00:00:00.000Z';
    const cookieBody = { user: { id: 'u1', email: 'a@b.c' }, session: { expiresAt: ends } };
    expect(await ask(answering(200, cookieBody, seen), COOKIE)).toEqual({
      user: { id: 'u1', email: 'a@b.c' },
      ends: Date.parse(ends),
    });
    const row = { userId: 'u2', clientId: 'cli', accessTokenExpiresAt: ends };
    expect(await ask(answering(200, row, seen), BEARER)).toEqual({
      user: { id: 'u2' },
      ends: Date.parse(ends),
    });
    expect(seen.map((init) => [init.redirect, new Headers(init.headers).get('origin')])).toEqual([
      ['error', null],
      ['error', null],
    ]);
  });

  it.each([
    ['200 with null', 200, null],
    ['401', 401, {}],
    ['a PAT client row', 200, { userId: 'u2', clientId: 'pat:x' }],
  ])('%s is signed out', async (_what, status, body) => {
    expect(await ask(answering(status, body), BEARER)).toBeNull();
  });

  it.each([
    ['429', 429, {}],
    ['500', 500, {}],
    ['a body it cannot read', 200, { user: {} }],
  ])('%s is a 503', async (_what, status, body) => {
    await expect(ask(answering(status, body), COOKIE)).rejects.toMatchObject({ status: 503 });
    await expect(ask(answering(status, body), BEARER)).rejects.toMatchObject({ status: 503 });
  });

  it('auth unreachable is a 503', async () => {
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    await expect(ask(down, COOKIE)).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
  });
});

describe('createIdentityRead: the cache of the session read', () => {
  const body = (ends: string) => ({ user: { id: 'u1' }, session: { expiresAt: ends } });

  it('the cache key is a sha256 of the token, never the token itself', () => {
    const key = keyOf(COOKIE, 'session');
    expect(key).toMatch(/^[0-9a-f]{64}:session$/);
    expect(key).not.toContain(TOKEN);
    const rotated = { cookie: `${COOKIE.cookie}; better-auth.session_data=d2` };
    expect(keyOf(rotated, 'session')).toBe(key);
    expect(keyOf(BEARER, 'session')).toMatch(/^[0-9a-f]{64}:session$/);
    expect(keyOf(BEARER, 'session')).not.toContain('oauth-opaque');
  });

  it('keeps a signed-in user 270 s at most, and 30 s less than the session end', async () => {
    let now = 0;
    const seen: RequestInit[] = [];
    const far = answering(200, body('2030-01-01T00:00:00.000Z'), seen);
    const read = createIdentityRead({ issuer: ISSUER, fetcher: far, now: () => now });
    await read(COOKIE);
    now = 269_000;
    await read(COOKIE);
    now = 271_000;
    await read(COOKIE);
    expect(seen).toHaveLength(2);
    const near = answering(200, body(new Date(60_000).toISOString()), seen);
    now = 0;
    const short = createIdentityRead({ issuer: ISSUER, fetcher: near, now: () => now });
    await short(COOKIE);
    now = 31_000;
    await short(COOKIE);
    expect(seen).toHaveLength(4);
  });

  it('parallel calls share one read; a failed read leaves no entry; forget drops the user', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return calls === 1 ? new Response('', { status: 502 }) : Response.json(body('2030-01-01'));
    }) as typeof fetch;
    const read = createIdentityRead({ issuer: ISSUER, fetcher });
    await expect(read(COOKIE)).rejects.toMatchObject({ status: 503 });
    expect(await Promise.all([read(COOKIE), read(COOKIE)])).toEqual([{ id: 'u1' }, { id: 'u1' }]);
    read.forget(COOKIE);
    await read(COOKIE);
    expect(calls).toBe(3);
  });
});
