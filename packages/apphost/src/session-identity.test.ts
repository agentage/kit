// B4: /shell/session reads the user with no extension id, so sign-in works on every host name.
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEARER_READ,
  cloudHost,
  COOKIE_READ,
  exchangesOf,
  type FakeAuth,
  fakeAuth,
  identityReadsOf,
  SESSION,
  USER,
} from './test-support/cloud-host.js';
import {
  closeUpstreams,
  cloudEnv,
  OWN,
  startCloud,
  type Started,
} from './test-support/cloud-start.js';

// The extension ids auth takes today (auth pat-scopes.ts); any other id is a 400.
const AUTH_IDS = ['probe', 'memory', 'root', 'market', 'cloud', 'logs', 'fixture', 'platform'];
const realAuth = () => fakeAuth((_access, id) => (AUTH_IDS.includes(id) ? 201 : 400));
const PAGE = { cookie: SESSION, origin: OWN, 'sec-fetch-site': 'same-origin' };
const ISSUER = { AGENTAGE_ISSUER: 'https://auth.next.agentage.io' };

let started: Started | undefined;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await started?.stop();
  await close?.();
  started = close = undefined;
  closeUpstreams();
});

const startNamed = async (name: string, auth: FakeAuth) => {
  const env = await cloudEnv({ extensions: [], upstreams: [] }, ISSUER);
  const file = env.AGENTAGE_INSTALLATION_FILE;
  const installation = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  await writeFile(file, JSON.stringify({ ...installation, host: name }));
  started = await startCloud(env, { fetcher: auth.fetcher });
  return started;
};

const answerOf = async (headers: Record<string, string>, auth = realAuth()) => {
  const host = await cloudHost(auth);
  close = host.close;
  const res = await host.server.fetch('/shell/session', { headers });
  return { auth, server: host.server, status: res.status, body: (await res.json()) as unknown };
};

describe('the session of a host whose name is not an extension id (B4)', () => {
  it.each(['core', 'test'])('host %s: a cookie signs in, no exchange is asked', async (name) => {
    const auth = realAuth();
    const host = await startNamed(name, auth);
    const res = await host.call('/shell/session', { headers: PAGE });
    expect([res.status, res.headers['cache-control']]).toEqual([200, 'no-store']);
    expect(JSON.parse(res.body)).toEqual({
      host: { kind: 'cloud' },
      signIn: null,
      signOut: null,
      user: USER,
    });
    expect(exchangesOf(auth)).toEqual([]);
    const [read] = identityReadsOf(auth);
    expect([read?.url, read?.headers.get('cookie'), read?.headers.get('origin')]).toEqual([
      COOKIE_READ,
      SESSION,
      null,
    ]);
  });

  it('a desktop bearer signs in through the read the daemon uses, with no cookie', async () => {
    const { auth, status, body } = await answerOf({ authorization: 'Bearer oauth-opaque' });
    expect([status, body]).toEqual([
      200,
      { host: { kind: 'cloud' }, signIn: null, signOut: null, user: { id: USER.id } },
    ]);
    const [read] = identityReadsOf(auth);
    expect([read?.url, read?.headers.get('authorization'), read?.headers.get('cookie')]).toEqual([
      BEARER_READ,
      'Bearer oauth-opaque',
      null,
    ]);
    expect(exchangesOf(auth)).toEqual([]);
  });

  it('a PAT is no sign-in and asks auth nothing', async () => {
    const { auth, body } = await answerOf({ authorization: 'Bearer aga_pat' });
    expect(body).toMatchObject({ user: null });
    expect(auth.calls).toEqual([]);
  });

  it('no session (200 with null) is the signed-out answer, for a cookie and a bearer', async () => {
    const auth = realAuth();
    auth.user = null;
    const both: Record<string, string>[] = [{ cookie: SESSION }, { authorization: 'Bearer gone' }];
    for (const headers of both) {
      const { status, body } = await answerOf(headers, auth);
      expect([status, body]).toMatchObject([200, { user: null, signOut: null }]);
      await close?.();
    }
  });

  it('auth unreachable is 503, never signed out', async () => {
    const auth = realAuth();
    auth.down = true;
    const { status, body } = await answerOf({ cookie: SESSION }, auth);
    expect([status, (body as { error: { code: string } }).error.code]).toEqual([
      503,
      'UNAVAILABLE',
    ]);
  });

  it('the identity read and the exchange share one miss limit of 30 per address', async () => {
    const auth = realAuth();
    const { server } = await answerOf({ cookie: SESSION, 'x-forwarded-for': '9.9.9.9' }, auth);
    const from = (path: string, n: number) =>
      server
        .fetch(path, {
          headers: { cookie: `better-auth.session_token=r${n}`, 'x-forwarded-for': '9.9.9.9' },
        })
        .then(async (res) => (await res.text(), res.status));
    const codes: number[] = [];
    for (let n = 1; n < 30; n++) codes.push(await from('/shell/session', n));
    expect([codes.every((c) => c === 200), await from('/api/market/x', 99)]).toEqual([true, 429]);
  });
});
