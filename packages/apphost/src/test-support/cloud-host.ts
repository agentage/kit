import { type IncomingHttpHeaders } from 'node:http';
import express from 'express';
import { createLog, errorHandler, startOn, type TestServer } from '@agentage/extension/internal';
import { withoutCredentials } from '../cloud-credentials.js';
import { createCloudSession } from '../cloud-session.js';

export const OWN = 'https://platform-host.next.agentage.io';
export const ISSUER = 'https://auth.next.agentage.io';
export const SESSION = 'better-auth.session_token=s1.sig';
export const USER = { id: 'u1', email: 'e2e@agentage.io' };
export const CLEARS = [
  'better-auth.session_token=; Max-Age=0; Domain=.agentage.io',
  'better-auth.session_data=; Max-Age=0; Domain=.agentage.io',
];

export interface AuthCall {
  url: string;
  headers: Headers;
  body: string;
}

// A fake auth: the exchange answers `exchange(access, id)`, the sign-out `signOut` with two clears.
export interface FakeAuth {
  exchange: (access: string, extension: string) => number;
  signOut: number;
  // Both identity reads: the status, and the user of a 200 (null: 200 with a null body).
  identity: number;
  user: typeof USER | null;
  // true: auth is unreachable (the fetch rejects).
  down: boolean;
  calls: AuthCall[];
  fetcher: typeof fetch;
}

const tokenOf = (body: string) => {
  const { extension } = JSON.parse(body) as { extension: string };
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  return { success: true, data: { token: `aga_${extension}.jwt`, user: USER, expiresAt } };
};

const signOutAnswer = (status: number) => {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (status < 400) for (const clear of CLEARS) headers.append('set-cookie', clear);
  return new Response('{"success":true}', { status, headers });
};

export const COOKIE_READ = '/api/auth/get-session';
export const BEARER_READ = '/api/auth/mcp/get-session';

const identityOf = (auth: FakeAuth, url: string) => {
  const ends = new Date(Date.now() + 86_400_000).toISOString();
  const { user } = auth;
  // The two shapes of Better Auth: the cookie session, the OAuth access token row.
  const cookie = user && { user: { ...user, name: 'E2E' }, session: { expiresAt: ends } };
  const bearer = user && { userId: user.id, clientId: 'cli', accessTokenExpiresAt: ends };
  const body = url === COOKIE_READ ? cookie : bearer;
  return Response.json(body, { status: auth.identity });
};

const answerOf = (auth: FakeAuth, url: string, body: string) => {
  if (url === '/api/auth/sign-out') return signOutAnswer(auth.signOut);
  if (url === COOKIE_READ || url === BEARER_READ) return identityOf(auth, url);
  const { access, extension } = JSON.parse(body) as { access: string; extension: string };
  return Response.json(tokenOf(body), { status: auth.exchange(access, extension) });
};

export const fakeAuth = (
  exchange: (access: string, extension: string) => number = () => 201
): FakeAuth => {
  const auth: FakeAuth = {
    exchange,
    signOut: 200,
    identity: 200,
    user: USER,
    down: false,
    calls: [],
    fetcher: fetch,
  };
  auth.fetcher = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : input);
    // The host reads its containers (127.0.0.1) with the same fetcher: those go out as sent.
    if (target.hostname === '127.0.0.1') return fetch(input, init);
    if (auth.down) throw new TypeError('fetch failed');
    const url = target.pathname;
    const body = typeof init?.body === 'string' ? init.body : '';
    auth.calls.push({ url, headers: new Headers(init?.headers), body });
    return answerOf(auth, url, body);
  };
  return auth;
};

export const exchangesOf = (auth: FakeAuth) =>
  auth.calls.filter((call) => call.url === '/account/extension-token');

export const identityReadsOf = (auth: FakeAuth) =>
  auth.calls.filter((call) => call.url === COOKIE_READ || call.url === BEARER_READ);

export interface CloudHost {
  server: TestServer;
  upstream: IncomingHttpHeaders[];
  close(): Promise<void>;
}

// The routes a cloud host gives the session: /shell/session, /shell/sign-out, api and mcp recorders.
export const cloudHost = async (auth: FakeAuth, issuer: string | undefined = ISSUER) => {
  const session = createCloudSession({ issuer, own: OWN, fetcher: auth.fetcher });
  const upstream: IncomingHttpHeaders[] = [];
  const app = express();
  app.get('/shell/session', async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await session.answer(req));
  });
  app.post('/shell/sign-out', session.signOut);
  app.all('/api/:id/{*rest}', async (req, res) => {
    upstream.push(withoutCredentials(await session.headersFor(req, String(req.params['id']))));
    res.json({});
  });
  app.all('/mcp/:id', (req, res) => {
    upstream.push(withoutCredentials(req.headers));
    res.json({});
  });
  app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
  const server = await startOn(app);
  return { server, upstream, close: server.close } satisfies CloudHost;
};
