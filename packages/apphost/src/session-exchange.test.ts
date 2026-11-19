import { describe, expect, it } from 'vitest';
import { createAddressLimit, createExchange } from './auth-exchange.js';

const SESSION = 'better-auth.session_token=s1.sig';
const ISSUER = 'https://auth.test';
const LATER = () => new Date(Date.now() + 300_000).toISOString();
const USER = { id: 'u1', email: 'e2e@agentage.io' };

const tokenAt = (expiresAt: string) =>
  new Response(JSON.stringify({ data: { token: 't', user: USER, expiresAt } }), { status: 201 });

// A fetcher that counts calls and answers `answer(access)`.
const counted = (answer: (access: string) => Response = () => tokenAt(LATER())) => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const { access } = JSON.parse(String(init?.body)) as { access: string };
    seen.push(access);
    return answer(access);
  };
  return { seen, fetcher };
};

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (err: { status?: number; code?: string }) => `${err.status} ${err.code}`
  );

describe('the auth exchange: cache and levels (J.4.4 row 2)', () => {
  it('parallel calls share one exchange', async () => {
    const { seen, fetcher } = counted();
    const exchange = createExchange({ issuer: ISSUER, fetcher });
    await Promise.all([1, 2, 3].map(() => exchange({ cookie: SESSION }, 'ext', 'write')));
    expect(seen).toHaveLength(1);
  });

  it('the cache ends 30 s before the token runs out', async () => {
    let clock = 0;
    const { seen, fetcher } = counted(() => tokenAt(new Date(300_000).toISOString()));
    const exchange = createExchange({ issuer: ISSUER, fetcher, now: () => clock });
    await exchange({ cookie: SESSION }, 'ext', 'write');
    clock = 269_000;
    await exchange({ cookie: SESSION }, 'ext', 'write');
    clock = 270_000;
    await exchange({ cookie: SESSION }, 'ext', 'write');
    expect(seen).toHaveLength(2);
  });

  it('the cache key is the session token value: a rotated data cookie is a hit, a drop reaches both', async () => {
    const { seen, fetcher } = counted();
    const exchange = createExchange({ issuer: ISSUER, fetcher });
    await exchange({ cookie: SESSION }, 'ext', 'write');
    await exchange({ cookie: `${SESSION}; better-auth.session_data=v1` }, 'ext', 'write');
    await exchange({ cookie: `better-auth.session_data=v2; ${SESSION}` }, 'ext', 'write');
    expect(seen).toHaveLength(1);
    exchange.forget({ cookie: `${SESSION}; better-auth.session_data=v3` });
    await exchange({ cookie: SESSION }, 'ext', 'write');
    expect(seen).toHaveLength(2);
  });

  it('two different token cookies in one header never share the key of one of them', async () => {
    const { seen, fetcher } = counted();
    const exchange = createExchange({ issuer: ISSUER, fetcher });
    await exchange({ cookie: SESSION }, 'ext', 'write');
    const planted = `__Secure-${SESSION}; ${SESSION.replace('s1', 'planted')}`;
    await exchange({ cookie: planted }, 'ext', 'write');
    expect(seen).toHaveLength(2);
  });

  it('a fallback costs one address-limit hit', async () => {
    const { fetcher } = counted((access) =>
      access === 'admin' ? new Response('{}', { status: 403 }) : tokenAt(LATER())
    );
    const exchange = createExchange({ issuer: ISSUER, fetcher, allow: createAddressLimit(1) });
    const data = await exchange({ cookie: SESSION }, 'ext', ['admin', 'write'], 'a');
    expect(data?.token).toBe('t');
  });

  it('sign-out forgets the admin and the write entry', async () => {
    const { seen, fetcher } = counted();
    const exchange = createExchange({ issuer: ISSUER, fetcher });
    const c = { cookie: SESSION };
    await exchange(c, 'ext', 'admin');
    await exchange(c, 'ext', 'write');
    exchange.forget(c);
    await exchange(c, 'ext', 'admin');
    await exchange(c, 'ext', 'write');
    expect(seen).toHaveLength(4);
  });

  it('a signed-out 401 on admin does not try write', async () => {
    const { seen, fetcher } = counted(() => new Response('{}', { status: 401 }));
    const exchange = createExchange({ issuer: ISSUER, fetcher });
    expect(await exchange({ cookie: SESSION }, 'ext', ['admin', 'write'])).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('a failed admin probe (429) still serves write; a refused admin is not asked again for minutes', async () => {
    let clock = 0;
    const { seen, fetcher } = counted((access) => {
      if (access !== 'admin') return tokenAt(new Date(1e9).toISOString());
      return new Response('{}', { status: seen.length === 1 ? 429 : 403 });
    });
    const exchange = createExchange({ issuer: ISSUER, fetcher, now: () => clock });
    const c = { cookie: SESSION };
    expect((await exchange(c, 'ext', ['admin', 'write']))?.token).toBe('t');
    await exchange(c, 'other', ['admin', 'write']);
    seen.length = 0;
    clock = 200_000;
    await exchange(c, 'other', ['admin', 'write']);
    expect(seen).toEqual([]);
    clock = 250_000;
    await exchange(c, 'other', ['admin', 'write']);
    expect(seen).toEqual(['admin']);
  });

  it('a failed exchange is not cached: the next call asks auth again', async () => {
    let status = 503;
    const { seen, fetcher } = counted(() =>
      status === 201 ? tokenAt(LATER()) : new Response('{}', { status })
    );
    const exchange = createExchange({ issuer: ISSUER, fetcher });
    expect(await codeOf(exchange({ cookie: SESSION }, 'ext', 'read'))).toBe('503 UNAVAILABLE');
    status = 201;
    expect((await exchange({ cookie: SESSION }, 'ext', 'read'))?.user).toEqual(USER);
    expect(seen).toHaveLength(2);
  });

  it('the address limit resets after a minute', () => {
    let clock = 0;
    const allow = createAddressLimit(1, () => clock);
    expect([allow('a'), allow('a'), allow('b')]).toEqual([true, false, true]);
    clock = 60_000;
    expect(allow('a')).toBe(true);
  });

  it('over the address limit a miss is 429 RATE_LIMITED; a cached entry still answers', async () => {
    const { seen, fetcher } = counted();
    const exchange = createExchange({ issuer: ISSUER, fetcher, allow: createAddressLimit(1) });
    await exchange({ cookie: SESSION }, 'ext', 'read', 'a');
    expect(
      await codeOf(exchange({ cookie: 'better-auth.session_token=r1' }, 'ext', 'read', 'a'))
    ).toBe('429 RATE_LIMITED');
    expect((await exchange({ cookie: SESSION }, 'ext', 'read', 'a'))?.token).toBe('t');
    expect(seen).toHaveLength(1);
  });
});
