import { describe, expect, it } from 'vitest';
import { createExchange } from './auth-exchange.js';

const SESSION = 'better-auth.session_token=s1.sig';
const ISSUER = 'https://auth.test';
const LATER = () => new Date(Date.now() + 300_000).toISOString();
const USER = { id: 'u1', email: 'e2e@agentage.io' };

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (err: { status?: number; code?: string }) => `${err.status} ${err.code}`
  );

describe('the auth exchange: every outside input fails closed (J.4.4 row 2)', () => {
  const once = (fetcher: typeof fetch, timeoutMs?: number) =>
    codeOf(
      createExchange({ issuer: ISSUER, fetcher, ...(timeoutMs && { timeoutMs }) })(
        { cookie: SESSION },
        'ext',
        'read'
      )
    );
  const answering =
    (body: string, status = 201): typeof fetch =>
    async () =>
      new Response(body, { status });

  it('auth 5xx and auth 429 are 503, never signed out', async () => {
    expect(await once(answering('{}', 500))).toBe('503 UNAVAILABLE');
    expect(await once(answering('{}', 429))).toBe('503 UNAVAILABLE');
  });

  it('auth 401 or another 4xx is signed out (null), 403 refused is null too', async () => {
    const exchange = (status: number) =>
      createExchange({ issuer: ISSUER, fetcher: answering('{}', status) })(
        { cookie: SESSION },
        'ext',
        'read'
      );
    expect([await exchange(401), await exchange(400), await exchange(403)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('auth unreachable is 503', async () => {
    expect(await once(async () => Promise.reject(new TypeError('fetch failed')))).toBe(
      '503 UNAVAILABLE'
    );
  });

  it('a 201 body that is not JSON is 503', async () => {
    expect(await once(answering('<html>'))).toBe('503 UNAVAILABLE');
  });

  it('a 201 body with a missing field is 503', async () => {
    const noToken = JSON.stringify({ data: { user: USER, expiresAt: LATER() } });
    expect(await once(answering(noToken))).toBe('503 UNAVAILABLE');
    expect(await once(answering(JSON.stringify({ success: true })))).toBe('503 UNAVAILABLE');
  });

  it('a 201 with an expiresAt that is not a date is 503', async () => {
    const bad = JSON.stringify({ data: { token: 't', user: USER, expiresAt: 'soon' } });
    expect(await once(answering(bad))).toBe('503 UNAVAILABLE');
  });

  it('auth that does not answer in time is 503', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      );
    expect(await once(hang, 20)).toBe('503 UNAVAILABLE');
  });

  it('only the id and the email of the user are kept', async () => {
    const extra = JSON.stringify({
      data: { token: 't', user: { ...USER, role: 'x' }, expiresAt: LATER() },
    });
    const data = await createExchange({ issuer: ISSUER, fetcher: answering(extra) })(
      { cookie: SESSION },
      'ext',
      'read'
    );
    expect(data?.user).toEqual(USER);
  });
});
