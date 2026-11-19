import { request } from 'node:http';
import { connect } from 'node:net';
import { type Request, type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardTo } from './cloud-proxy.js';
import { fakeAuth, SESSION } from './test-support/cloud-host.js';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  OWN_HOST,
  startCloud,
  type Started,
  upstream,
  type Upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const ISSUER = { AGENTAGE_ISSUER: 'https://auth.next.agentage.io' };
const PAT = 'Bearer aga_0123456789abcdef0123';
const ALL = { api: 'public', mcp: 'public', app: 'public' };

// echo: api, mcp and app public; inner: api internal; gone: listed, its upstream refuses.
const start = async () => {
  const echo = await upstream(docOf('echo', ['api', 'mcp', 'app']));
  const inner = await upstream(docOf('inner', ['api']));
  const auth = fakeAuth();
  const extensions = [
    { id: 'echo', expose: ALL },
    { id: 'inner', expose: { api: 'internal' } },
    { id: 'gone', expose: { api: 'public' } },
  ];
  const upstreams = [
    { id: 'echo', address: echo.address },
    { id: 'inner', address: inner.address },
    { id: 'gone', address: 'http://127.0.0.1:1' },
  ];
  host = await startCloud(await cloudEnv({ extensions, upstreams }, ISSUER), {
    fetcher: auth.fetcher,
  });
  return { echo, inner, auth, call: host.call };
};

const last = (up: Upstream) => up.seen.at(-1)!;

// A request line as a client may send it: fetch and node:http only send origin-form.
const raw = (port: number, target: string) =>
  new Promise<string>((resolve) => {
    const socket = connect(port, '127.0.0.1', () =>
      socket.end(`GET ${target} HTTP/1.1\r\nHost: ${OWN_HOST}\r\nConnection: close\r\n\r\n`)
    );
    let text = '';
    socket.on('data', (c: Buffer) => (text += c.toString()));
    socket.on('end', () => resolve(text.split('\r\n')[0] ?? ''));
  });

// The status and whether the body came whole; resolves when the answer closes, cut or not.
const cut = (port: number, path: string) =>
  new Promise<{ status: number; complete: boolean }>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host: OWN_HOST } }, (res) => {
      res.on('error', () => undefined).resume();
      res.on('close', () => resolve({ status: res.statusCode ?? 0, complete: res.complete }));
    });
    req.on('error', () => undefined).end();
  });

describe('cloud routes: only public routes of running entries', () => {
  it('a public part is proxied at its own path; an internal one and an unknown id are 404', async () => {
    const { echo, inner, call } = await start();
    expect((await call('/api/echo/hi?x=1')).status).toBe(200);
    expect(last(echo)).toMatchObject({ method: 'GET', url: '/api/echo/hi?x=1' });
    expect((await call('/mcp/echo', { method: 'POST' })).status).toBe(200);
    expect((await call('/api/inner/hi')).status).toBe(404);
    expect((await call('/api/nobody/hi')).status).toBe(404);
    expect(inner.seen).toEqual([]);
  });

  it('a public part not running is 503 with Retry-After', async () => {
    const { call } = await start();
    const res = await call('/api/gone/hi');
    expect([res.status, res.headers['retry-after']]).toEqual([503, '5']);
  });

  it('an upstream that does not answer is 502 BAD_GATEWAY', async () => {
    const { echo, call } = await start();
    echo.server.prependListener('request', (req: { socket: { destroy(): void } }) =>
      req.socket.destroy()
    );
    const res = await call('/api/echo/hi');
    expect([res.status, (JSON.parse(res.body) as { error: { code: string } }).error.code]).toEqual([
      502,
      'BAD_GATEWAY',
    ]);
  });

  it('an upstream gone in the middle of its body cuts the answer, never leaves it open', async () => {
    const { echo } = await start();
    echo.custom = (req, res) => {
      if (req.url !== '/api/echo/cut') return false;
      res.writeHead(200, { 'content-length': '100' }).write('half');
      setTimeout(() => res.socket?.destroy(), 20);
      return true;
    };
    expect(await cut(host!.port, '/api/echo/cut')).toEqual({ status: 200, complete: false });
  });

  it('the app part: GET only, no Cookie and no Authorization, never a token', async () => {
    const { echo, auth, call } = await start();
    const headers = { cookie: `${SESSION}; theme=dark`, authorization: PAT };
    expect((await call('/app/echo/index.html', { headers })).status).toBe(200);
    expect(last(echo).headers).not.toHaveProperty('cookie');
    expect(last(echo).headers).not.toHaveProperty('authorization');
    expect((await call('/app/echo/x', { method: 'POST' })).status).toBe(404);
    expect(auth.calls).toEqual([]);
  });

  it('headersFor only on /api/*: the api part gets the exchanged token, mcp keeps a PAT only', async () => {
    const { echo, auth, call } = await start();
    const page = { cookie: SESSION, 'sec-fetch-site': 'same-origin' };
    await call('/api/echo/hi', { headers: page });
    expect(last(echo).headers.authorization).toBe('Bearer aga_echo.jwt');
    await call('/mcp/echo', { method: 'POST', headers: page });
    expect(last(echo).headers).not.toHaveProperty('authorization');
    expect(last(echo).headers).not.toHaveProperty('cookie');
    await call('/mcp/echo', { method: 'POST', headers: { authorization: PAT } });
    expect(last(echo).headers.authorization).toBe(PAT);
    expect(auth.calls).toHaveLength(1);
  });

  it('Set-Cookie of an upstream answer is removed', async () => {
    const { call } = await start();
    expect((await call('/api/echo/hi')).headers).not.toHaveProperty('set-cookie');
  });

  it('HEAD is a GET to the upstream with no body to the client', async () => {
    const { echo, call } = await start();
    const res = await call('/api/echo/hi', { method: 'HEAD' });
    expect([res.status, res.body, last(echo).method]).toEqual([200, '', 'GET']);
  });

  it.each(['http://evil.example/api/echo/hi', '//evil.example/api/echo/hi', '/\\evil.example/'])(
    'a request target that is not origin-form is 400: %s',
    async (target) => {
      const { echo } = await start();
      expect(await raw(host!.port, target)).toContain('400');
      expect(echo.seen).toEqual([]);
    }
  );

  it('a path that leaves the upstream is refused; dot segments are routed after they resolve', async () => {
    const { echo, inner, call } = await start();
    // /api/inner/x: inner is internal, so 404 and inner never sees it (the stub router routes the same).
    expect((await call('/api/echo/../../api/inner/x')).status).toBe(404);
    expect(inner.seen).toEqual([]);
    expect((await call('/api/echo/%2f%2fevil.example/x')).status).toBe(200);
    expect(last(echo).url).toBe('/api/echo/%2f%2fevil.example/x');
    const next = vi.fn();
    const req = { originalUrl: '//evil.example/x' } as Request;
    forwardTo(req, {} as Response, next, {
      id: 'echo',
      prefix: '/',
      upstream: echo.address,
      headers: {},
    });
    expect((next.mock.calls[0]?.[0] as { status: number }).status).toBe(400);
  });
});

describe('cloud security: Host, x-agentage-*, credentials', () => {
  it('a Host that is not the name of AGENTAGE_URL is refused; /health answers any Host (the probe)', async () => {
    const { echo, call } = await start();
    const res = await call('/api/echo/hi', { headers: { host: 'evil.example' } });
    expect([res.status, echo.seen]).toEqual([400, []]);
    expect((await call('/health', { headers: { host: '127.0.0.1:3000' } })).status).toBe(200);
  });

  it('a client x-agentage-* header never reaches the upstream; the host is forwarded as sent', async () => {
    const { echo, call } = await start();
    await call('/api/echo/hi', { headers: { 'x-agentage-user': 'admin', 'x-other': '1' } });
    expect(last(echo).headers).not.toHaveProperty('x-agentage-user');
    expect(last(echo).headers).toMatchObject({ 'x-other': '1', host: OWN_HOST });
  });

  it('every credential is stripped before the upstream except a PAT', async () => {
    const { echo, call } = await start();
    const headers = {
      cookie: `${SESSION}; theme=dark`,
      authorization: 'Bearer eyJdesktop',
      'proxy-authorization': 'x',
    };
    await call('/mcp/echo', { method: 'POST', headers });
    expect(last(echo).headers).toMatchObject({ cookie: 'theme=dark' });
    expect(last(echo).headers).not.toHaveProperty('authorization');
    expect(last(echo).headers).not.toHaveProperty('proxy-authorization');
  });
});
