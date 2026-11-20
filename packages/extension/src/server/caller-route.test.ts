import { afterEach, describe, expect, it } from 'vitest';
import { CallerAnswerSchema } from '../auth/caller.schema.js';
import { type Caller } from '../auth/token-check.js';
import { createRouteRegistry } from '../api/routes.js';
import { startTestServer, type TestServer } from '../testing/test-server.js';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = async (caller?: Caller | null) => {
  server = await startTestServer({
    caller,
    create: ({ route }) => route('get', '/ping', { summary: 'Ping', scope: 'public' }, () => 1),
  });
  return server;
};

const as = (...scopes: string[]): Caller => ({ sub: 'usr_1', scopes });

const read = async (caller?: Caller | null) => {
  const res = await (await start(caller)).fetch('/api/test/caller');
  const body = (await res.json()) as { success: boolean; data?: unknown; error?: unknown };
  return { status: res.status, cache: res.headers.get('cache-control'), body };
};

describe('GET /api/{id}/caller: the caller of a token-checked api', () => {
  it.each([
    ['read', ['test:read']],
    ['write', ['test:write']],
    ['admin', ['test:admin']],
  ])('a %s token gets 200, no-store, its own sub and scopes', async (_verb, scopes) => {
    const answer = await read(as(...scopes));
    expect(answer).toEqual({
      status: 200,
      cache: 'no-store',
      body: { success: true, data: { sub: 'usr_1', scopes } },
    });
  });

  it('answers only this id scopes, as held, in verb order: strict keys', async () => {
    const answer = await read(as('memory:admin', 'test:admin', 'test:read', 'test:readx', 'x'));
    expect(Object.keys(answer.body)).toEqual(['success', 'data']);
    expect(Object.keys(answer.body.data as object).sort()).toEqual(['scopes', 'sub']);
    expect(answer.body.data).toEqual({ sub: 'usr_1', scopes: ['test:read', 'test:admin'] });
    expect(CallerAnswerSchema.safeParse({ ...(answer.body.data as object), x: 1 }).success).toBe(
      false
    );
  });

  it('no token: 401 in the envelope, no-store', async () => {
    const answer = await read(null);
    expect([answer.status, answer.cache]).toEqual([401, 'no-store']);
    expect(answer.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('a token of another extension id: 403', async () => {
    const answer = await read(as('memory:admin', 'probe:read'));
    expect([answer.status, answer.cache]).toEqual([403, 'no-store']);
    expect(answer.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('no route where the api checks no token', async () => {
    expect((await read()).status).toBe(404);
  });

  it('an extension cannot register the kit path', () => {
    const { route } = createRouteRegistry();
    for (const path of ['/caller', '/Caller'])
      expect(() => route('post', path, { summary: 'Mine' }, () => 1)).toThrow(/kit route/);
  });
});
