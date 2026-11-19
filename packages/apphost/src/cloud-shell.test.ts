import { afterEach, describe, expect, it } from 'vitest';
import { createCloudSession } from './cloud-session.js';
import { exchangesOf, fakeAuth, SESSION, USER } from './test-support/cloud-host.js';
import {
  closeUpstreams,
  OWN,
  openFeed,
  startWithShell,
  type Started,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const ISSUER = 'https://auth.next.agentage.io';
const NO_ROWS = { extensions: [], upstreams: [] };
const PAGE = { cookie: SESSION, origin: OWN, 'sec-fetch-site': 'same-origin' };

const start = async (auth = fakeAuth()) => {
  host = await startWithShell(
    NO_ROWS,
    { AGENTAGE_ISSUER: ISSUER },
    {
      fetcher: auth.fetcher,
    }
  );
  return { auth, call: host.call };
};

describe('the cloud session routes (L7 wired)', () => {
  it('GET /shell/session: answer(req), no-store, no CORS header; read for the installation host id', async () => {
    const { auth, call } = await start();
    const res = await call('/shell/session', { headers: PAGE });
    expect(JSON.parse(res.body)).toEqual({
      host: { kind: 'cloud' },
      signIn: null,
      signOut: '/shell/sign-out',
      user: USER,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
    expect(JSON.parse(exchangesOf(auth)[0]!.body)).toEqual({
      extension: 'site',
      access: 'read',
    });
  });

  it('a host id auth does not know (400) answers signed out, as today', async () => {
    const { call } = await start(fakeAuth(() => 400));
    const body = JSON.parse((await call('/shell/session', { headers: PAGE })).body) as {
      user: unknown;
    };
    expect(body.user).toBeNull();
  });

  it('POST /shell/sign-out ends the auth session and sends its clears', async () => {
    const { auth, call } = await start();
    const res = await call('/shell/sign-out', { method: 'POST', headers: PAGE });
    expect([res.status, auth.calls.at(-1)?.url]).toEqual([200, '/api/auth/sign-out']);
    expect(res.headers['set-cookie']).toHaveLength(2);
  });

  it("two users: A's sign-in and sign-out send nothing to B's open feed", async () => {
    const { call } = await start();
    const feed = await openFeed(host!.port);
    await call('/shell/session', { headers: PAGE });
    await call('/shell/sign-out', { method: 'POST', headers: PAGE });
    await host!.refresh();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(feed.chunks.join('')).toMatch(/^retry: 1000\nid: [0-9a-f]{12}\n\n$/);
    feed.close();
  });
});

describe('HEAD /shell/events', () => {
  it('sends the headers and ends: no stream stays open', async () => {
    const { call } = await start();
    const res = await call('/shell/events', { method: 'HEAD' });
    expect([res.status, res.headers['content-type'], res.body]).toEqual([
      200,
      'text/event-stream',
      '',
    ]);
  });
});

describe('the fixes of the review of #164', () => {
  it('own is an origin: AGENTAGE_URL with a trailing slash does not refuse a same-origin page', async () => {
    const auth = fakeAuth();
    const session = createCloudSession({
      issuer: ISSUER,
      own: `${OWN}/`,
      host: 'h',
      fetcher: auth.fetcher,
    });
    const headers = await session.headersFor({ headers: PAGE }, 'echo');
    expect(headers.authorization).toBe('Bearer aga_echo.jwt');
  });

  it.each(['http://auth.next.agentage.io', 'https://auth.next.agentage.io/x', 'httpx'])(
    'issuer %s is no https origin: no sign-in, auth never asked',
    async (issuer) => {
      const auth = fakeAuth();
      const session = createCloudSession({ issuer, own: OWN, host: 'h', fetcher: auth.fetcher });
      expect(await session.answer({ headers: PAGE })).toMatchObject({ signIn: null, user: null });
      expect(auth.calls).toEqual([]);
    }
  );

  it('the dev issuer over http signs in only in a local run', async () => {
    const auth = fakeAuth(() => 401);
    const issuer = 'http://issuer:3000';
    const local = createCloudSession({
      issuer,
      local: true,
      own: OWN,
      host: 'h',
      fetcher: auth.fetcher,
    });
    const answer = await local.answer({ headers: PAGE });
    expect(answer.signIn).toBe(`${issuer}/sign-in?next=${encodeURIComponent(`${OWN}/`)}`);
  });
});
