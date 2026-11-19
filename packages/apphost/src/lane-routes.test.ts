import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler, createLog, startOn, type TestServer } from '@agentage/extension/internal';
import { type Entries } from './entries.js';
import { type Lane } from './lane.js';
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

const entryOf = (id: string, port?: number): Entry => {
  const lane = port === undefined ? undefined : ({ child: { port } } as unknown as Lane);
  return { id, install: { id }, state: 'running', version: '1.0.0', lane };
};

// The check alone, with a stand-in for the proxy that answers 204.
const start = async (entries: Entries) => {
  const app = express();
  app.use('/api/:id', servesPart(entries, 'api'), (_req, res) => void res.sendStatus(204));
  app.use('/mcp/:id', servesPart(entries, 'mcp'), (_req, res) => void res.sendStatus(204));
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
