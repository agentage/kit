import express from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { errorHandler } from '../../server/errors.js';
import { startOn } from '../../testing/test-server.js';
import { createLog } from '../../log/log.js';
import { type Entries } from './entries.js';
import { endToEnd, proxyTo } from './proxy.js';
import { laneOf } from './lane.js';
import { type Entry } from './supervisor.js';

// A child that takes each request and never answers (or does what onRequest says); seen holds them.
const silentChild = async (onRequest = (_req: IncomingMessage) => undefined) => {
  const seen: IncomingMessage[] = [];
  const server = createServer((req) => void (seen.push(req), onRequest(req)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const child = {
    port,
    pid: 1,
    exited: new Promise<never>(() => undefined),
    stop: async () => undefined,
  };
  const entry: Entry = { id: 'mute', install: { id: 'mute' }, state: 'running', version: '1.0.0' };
  entry.lane = laneOf(child);
  const close = () => (server.closeAllConnections(), server.close());
  return { seen, entries: new Map([['mute', entry]]) as Entries, entry, close };
};

const daemonOn = async (entries: Entries, answerMs: number) => {
  const app = express().use('/api/:id', proxyTo(entries, { gateMs: 1_000, answerMs }));
  app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
  return startOn(app);
};

describe('proxyTo', () => {
  it('a request held by a swap that does not end in time gets 503 in the envelope', async () => {
    const entry: Entry = {
      id: 'slow',
      install: { id: 'slow' },
      state: 'running',
      version: '1.0.0',
    };
    entry.gate = new Promise(() => undefined);
    const entries: Entries = new Map([['slow', entry]]);
    const app = express().use('/api/:id', proxyTo(entries, { gateMs: 50, answerMs: 1_000 }));
    app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
    const server = await startOn(app);
    const res = await server.fetch('/api/slow/echo');
    expect([res.status, await res.json()]).toMatchObject([503, { error: { code: 'UNAVAILABLE' } }]);
    await server.close();
  });
});

describe('proxyTo, a child that drops the socket', () => {
  it('before its headers: 503 "The extension did not answer" with Retry-After', async () => {
    const child = await silentChild((req) => void req.socket.destroy());
    const daemon = await daemonOn(child.entries, 1_000);
    const res = await daemon.fetch('/api/mute/x');
    expect([res.status, res.headers.get('retry-after'), await res.json()]).toMatchObject([
      503,
      '5',
      { error: { code: 'UNAVAILABLE', message: 'The extension did not answer' } },
    ]);
    await daemon.close();
    child.close();
  });
});

describe('proxyTo, a child that drops the socket after its headers', () => {
  it('cuts the answer (no envelope after the headers) and frees the lane', async () => {
    const head = 'HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhello\r\n';
    const child = await silentChild((req) => void req.socket.end(head, () => req.socket.destroy()));
    const daemon = await daemonOn(child.entries, 1_000);
    const res = await daemon.fetch('/api/mute/x');
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow('terminated');
    await vi.waitFor(() => expect(child.entry.lane?.open).toBe(0));
    await daemon.close();
    child.close();
  });
});

describe('endToEnd', () => {
  it('drops hop-by-hop headers and the ones Connection names, keeps the rest', () => {
    const headers = {
      connection: 'keep-alive, x-hop',
      'keep-alive': 'timeout=5',
      'x-hop': '1',
      upgrade: 'h2c',
      te: 'trailers',
      'proxy-authorization': 'Basic x',
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
      agcid: 'a',
    };
    expect(endToEnd(headers)).toEqual({ 'content-type': 'application/json', agcid: 'a' });
  });
});

describe('a client that goes away', () => {
  it('aborts its request to the child, so a swap does not wait for it', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const h = await startHarness({ drainMs: 5_000 });
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { source: await hostedPackage(NO_STORE_MANIFEST) });
    const abort = new AbortController();
    const hung = fetch(`http://127.0.0.1:${h.daemon.port}/api/hosted/hang`, abort);
    await new Promise((resolve) => setTimeout(resolve, 50));
    abort.abort();
    await hung.catch(() => undefined);
    const started = Date.now();
    const change = await h.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 'a' },
    });
    expect(change.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2_000);
    await h.daemon.stop();
    vi.restoreAllMocks();
  });
});

describe('the wait for the child', () => {
  it('a child that sends no answer headers in answerMs is 504 in the envelope; the request is dropped', async () => {
    const mute = await silentChild();
    const server = await daemonOn(mute.entries, 150);
    const started = Date.now();
    const res = await server.fetch('/api/mute/echo');
    expect([res.status, await res.json()]).toMatchObject([
      504,
      {
        success: false,
        error: { code: 'TIMEOUT', message: 'The extension did not answer in 150 ms' },
      },
    ]);
    expect(Date.now() - started).toBeLessThan(2_000);
    await vi.waitFor(() => expect(mute.seen[0]?.destroyed).toBe(true));
    expect(mute.entry.lane?.open).toBe(0);
    await server.close();
    mute.close();
  });

  it('a client abort closes the request on the child socket at once', async () => {
    const mute = await silentChild();
    const server = await daemonOn(mute.entries, 60_000);
    const abort = new AbortController();
    const sent = server.fetch('/api/mute/echo', { signal: abort.signal }).catch(() => 'aborted');
    await vi.waitFor(() => expect(mute.seen).toHaveLength(1));
    const closed = new Promise((resolve) => mute.seen[0]!.socket.once('close', resolve));
    abort.abort();
    expect(await sent).toBe('aborted');
    await closed;
    expect(mute.entry.lane?.open).toBe(0);
    await server.close();
    mute.close();
  });
});

describe('proxyTo and the host token (D11)', () => {
  it('keeps the host token from the child; another Authorization passes', async () => {
    const got: (string | undefined)[] = [];
    const server = createServer((req, res) => (got.push(req.headers.authorization), res.end('{}')));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const child = {
      port: (server.address() as AddressInfo).port,
      pid: 1,
      exited: new Promise<never>(() => undefined),
      stop: async () => undefined,
    };
    const entry: Entry = {
      id: 'x',
      install: { id: 'x' },
      state: 'running',
      version: '1.0.0',
      lane: laneOf(child),
    };
    const app = express().use(
      '/api/:id',
      proxyTo(new Map([['x', entry]]), { gateMs: 50, answerMs: 1_000 }, 'host-tok')
    );
    const daemon = await startOn(app);
    await daemon.fetch('/api/x/a', { headers: { authorization: 'Bearer host-tok' } });
    await daemon.fetch('/api/x/a', { headers: { authorization: 'Bearer own' } });
    expect(got).toEqual([undefined, 'Bearer own']);
    await daemon.close();
    server.close();
  });
});
