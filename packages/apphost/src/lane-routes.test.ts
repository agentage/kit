import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler, createLog, startOn, type TestServer } from '@agentage/extension/internal';
import { type Entries } from './entries.js';
import { addressFor, type Lane } from './lane.js';
import { FAILED_READ_MS, laneRoutes, servesPart } from './lane-routes.js';
import { type Entry } from './supervisor.js';

const docOf = (id: string, serves: string[]) => ({
  id,
  version: '1.0.0',
  commit: 'a'.repeat(40),
  buildTime: '2026-11-19T00:00:00Z',
  host: 'http://127.0.0.1:1',
  parts: Object.fromEntries(serves.map((p) => [p, {}])),
  serves,
});

const servers: Server[] = [];
let daemon: TestServer | undefined;
afterEach(async () => {
  servers.splice(0).forEach((s) => (s.closeAllConnections(), s.close()));
  await daemon?.close();
  daemon = undefined;
});

// A child that answers its discovery path with status and body and counts the reads.
const child = async (status: number, body: string) => {
  const reads = { n: 0 };
  const server = createServer((_req, res) => (reads.n++, res.writeHead(status).end(body)));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, reads };
};

const at = (port: number) => `http://127.0.0.1:${port}`;

// A lane with one address per port: a child has one; an upstream id may have two (api, pages).
const entryOf = (id: string, ...ports: number[]): Entry => {
  const child = { address: () => at(ports[0] ?? 0), addresses: () => ports.map(at) };
  const lane = ports.length ? ({ child } as unknown as Lane) : undefined;
  return { id, install: { id }, state: 'running', version: '1.0.0', lane };
};

// The check alone, with a stand-in for the proxy that answers 204 and names its address.
const start = async (entries: Entries) => {
  const app = express();
  const proxy: RequestHandler = (req, res) => {
    const lane = entries.get(String(req.params['id']))?.lane;
    if (lane) res.setHeader('x-to', addressFor(lane, res.locals));
    res.sendStatus(204);
  };
  app.use('/api/:id', servesPart(entries, 'api'), proxy);
  app.use('/mcp/:id', servesPart(entries, 'mcp'), proxy);
  app.use(errorHandler(createLog({ extension: 'host', part: 'api', version: '0.0.0' })));
  daemon = await startOn(app);
  return (path: string) => fetch(`${daemon?.url}${path}`);
};

describe('servesPart: the routes of a local child come from combineHost (J.4.3 row 4)', () => {
  it('a child that serves api only: /api/{id} goes on, /mcp/{id} is 404; one read per lane', async () => {
    const { port, reads } = await child(200, JSON.stringify(docOf('a', ['api'])));
    const call = await start(new Map([['a', entryOf('a', port)]]));
    expect((await call('/api/a/x')).status).toBe(204);
    expect((await call('/api/a/y')).status).toBe(204);
    const mcp = await call('/mcp/a');
    expect([mcp.status, (await mcp.json()) as unknown]).toMatchObject([
      404,
      { error: { code: 'NOT_FOUND' } },
    ]);
    expect(reads.n).toBe(1);
  });

  it('every address of an id is an answer: each part goes to the address that serves it', async () => {
    const api = await child(200, JSON.stringify(docOf('site', ['api'])));
    const mcp = await child(200, JSON.stringify(docOf('site', ['mcp'])));
    const entry = entryOf('site', api.port, mcp.port);
    const call = await start(new Map([['site', entry]]));
    expect((await call('/api/site/x')).headers.get('x-to')).toBe(at(api.port));
    expect((await call('/mcp/site')).headers.get('x-to')).toBe(at(mcp.port));
    const routes = await laneRoutes(entry, entry.lane as Lane);
    expect(routes?.map((r) => [r.part, r.upstream])).toEqual([
      ['api', at(api.port)],
      ['mcp', at(mcp.port)],
    ]);
  });

  it('a document of another id is refused: 404 on the api of a child that runs', async () => {
    const { port } = await child(200, JSON.stringify(docOf('b', ['api'])));
    const call = await start(new Map([['a', entryOf('a', port)]]));
    expect((await call('/api/a/x')).status).toBe(404);
  });

  it('no document (a 500) is 503 with a retry; the failure is kept, then read again', async () => {
    const { port, reads } = await child(500, 'no');
    const call = await start(new Map([['a', entryOf('a', port)]]));
    const res = await call('/api/a/x');
    expect([res.status, res.headers.get('retry-after')]).toEqual([503, '5']);
    expect((await call('/api/a/x')).status).toBe(503);
    expect(reads.n).toBe(1);
  });

  it('a failed read is read again after FAILED_READ_MS', async () => {
    const { port, reads } = await child(500, 'no');
    const entry = entryOf('a', port);
    const lane = entry.lane as Lane;
    let at = 0;
    const now = () => at;
    expect(await laneRoutes(entry, lane, now)).toBeUndefined();
    at = FAILED_READ_MS - 1;
    expect(await laneRoutes(entry, lane, now)).toBeUndefined();
    expect(reads.n).toBe(1);
    at = FAILED_READ_MS;
    await laneRoutes(entry, lane, now);
    expect(reads.n).toBe(2);
  });

  it('a read that throws is a failed read: nothing stays on the lane, the failure is kept', async () => {
    const lane = {
      get child(): never {
        throw new Error('no child');
      },
    } as unknown as Lane;
    const entry = { ...entryOf('a'), lane };
    expect(await laneRoutes(entry, lane, () => 0)).toBeUndefined();
    expect([lane.routes, lane.failedUntil]).toEqual([undefined, FAILED_READ_MS]);
  });

  it('parallel first requests share one read', async () => {
    const { port, reads } = await child(200, JSON.stringify(docOf('a', ['api'])));
    const call = await start(new Map([['a', entryOf('a', port)]]));
    const all = await Promise.all([1, 2, 3, 4].map(() => call('/api/a/x')));
    expect(all.map((r) => r.status)).toEqual([204, 204, 204, 204]);
    expect(reads.n).toBe(1);
  });

  it('no entry or no child: the proxy decides, as before', async () => {
    const call = await start(new Map([['a', entryOf('a')]]));
    expect((await call('/api/a/x')).status).toBe(204);
    expect((await call('/api/zz/x')).status).toBe(204);
  });
});
