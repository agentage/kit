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

// A fake auth: the exchange answers `exchange(access)`, the sign-out `signOut` with two clears.
export interface FakeAuth {
  exchange: (access: string) => number;
  signOut: number;
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

export const fakeAuth = (exchange: (access: string) => number = () => 201): FakeAuth => {
  const auth: FakeAuth = { exchange, signOut: 200, down: false, calls: [], fetcher: fetch };
  auth.fetcher = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : input);
    // The host reads its containers (127.0.0.1) with the same fetcher: those go out as sent.
    if (target.hostname === '127.0.0.1') return fetch(input, init);
    if (auth.down) throw new TypeError('fetch failed');
    const url = target.pathname;
    const body = typeof init?.body === 'string' ? init.body : '';
    auth.calls.push({ url, headers: new Headers(init?.headers), body });
    if (url === '/api/auth/sign-out') return signOutAnswer(auth.signOut);
    const { access } = JSON.parse(body) as { access: string };
    return Response.json(tokenOf(body), { status: auth.exchange(access) });
  };
  return auth;
};

export const exchangesOf = (auth: FakeAuth) =>
  auth.calls.filter((call) => call.url === '/account/extension-token');

export interface CloudHost {
  server: TestServer;
  upstream: IncomingHttpHeaders[];
  close(): Promise<void>;
}

// The routes a cloud host gives the session: /shell/session, /shell/sign-out, api and mcp recorders.
export const cloudHost = async (
  auth: FakeAuth,
  host: string,
  issuer: string | undefined = ISSUER
) => {
  const session = createCloudSession({ issuer, own: OWN, host, fetcher: auth.fetcher });
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
