import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { type Entries } from './entries.js';
import { DOC_READ_MS, hostDocumentOf, readChildDocument, type LastGood } from './host-document.js';
import { type Lane } from './lane.js';
import { type Entry, type State } from './supervisor.js';

const docOf = (id: string, version = '1.0.0') => ({
  id,
  version,
  commit: 'a'.repeat(40),
  buildTime: '2026-11-19T00:00:00Z',
  host: 'http://127.0.0.1:1',
  parts: { api: {} },
  serves: ['api'],
});

const servers: Server[] = [];
afterEach(() =>
  servers.splice(0).forEach((s) => {
    s.closeAllConnections();
    s.close();
  })
);

// A child on loopback that answers its document path with status and body.
const child = async (status: number, body: string): Promise<number> => {
  const server = createServer((_req, res) => res.writeHead(status).end(body));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

// A child that takes the request and never answers.
const slow = async (): Promise<number> => {
  const server = createServer(() => undefined);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

const entryOf = (id: string, state: State, port?: number): Entry => {
  const lane = port === undefined ? undefined : ({ child: { port } } as unknown as Lane);
  return { id, install: { id }, state, version: '1.0.0', lane };
};

const entriesOf = (...list: Entry[]): Entries => new Map(list.map((e) => [e.id, e]));

describe('readChildDocument: an answer from outside the daemon', () => {
  it('reads a JSON document; a 500, a body that is not JSON, or one over 256 KiB is none', async () => {
    expect(await readChildDocument(await child(200, JSON.stringify(docOf('a'))))).toMatchObject({
      id: 'a',
    });
    expect(await readChildDocument(await child(500, JSON.stringify(docOf('a'))))).toBeUndefined();
    expect(await readChildDocument(await child(200, '<html>'))).toBeUndefined();
    const big = JSON.stringify({ ...docOf('a'), pad: 'x'.repeat(300 * 1024) });
    expect(await readChildDocument(await child(200, big))).toBeUndefined();
  });

  it('a child that never answers is none after DOC_READ_MS', async () => {
    const server = createServer(() => undefined);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const started = Date.now();
    expect(await readChildDocument((server.address() as AddressInfo).port)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(DOC_READ_MS + 1_000);
    server.closeAllConnections();
  });

  it('a closed port is none, at once', async () => {
    const port = await child(200, '{}');
    servers.splice(0).forEach((s) => s.close());
    expect(await readChildDocument(port)).toBeUndefined();
  });
});

describe('hostDocumentOf: the host document from the discovery of each child (J.4.3 row 4)', () => {
  it('kind local, the running child with the fields of its own document', async () => {
    const port = await child(200, JSON.stringify(docOf('a')));
    const doc = await hostDocumentOf(entriesOf(entryOf('a', 'running', port)), new Map());
    expect([doc.kind, doc.extensions[0]?.state]).toEqual(['local', 'running']);
    expect(doc.extensions[0]).toMatchObject({ id: 'a', commit: 'a'.repeat(40), parts: ['api'] });
  });

  it('a child that stopped keeps its last good document, with the state the daemon knows', async () => {
    const lastGood: LastGood = new Map();
    const port = await child(200, JSON.stringify({ ...docOf('a'), serves: ['api', 'app'], app }));
    await hostDocumentOf(entriesOf(entryOf('a', 'running', port)), lastGood);
    const doc = await hostDocumentOf(entriesOf(entryOf('a', 'failed')), lastGood);
    expect(doc.extensions).toMatchObject([{ id: 'a', state: 'failed', app: { title: 'A' } }]);
  });

  it.each([
    ['answers slower than DOC_READ_MS', () => slow()],
    ['answers 500', () => child(500, 'no')],
  ])(
    'a running child with no app part that %s stays running on its last good document',
    async (_n, next) => {
      const lastGood: LastGood = new Map();
      const first = await child(200, JSON.stringify(docOf('a')));
      await hostDocumentOf(entriesOf(entryOf('a', 'running', first)), lastGood);
      const doc = await hostDocumentOf(entriesOf(entryOf('a', 'running', await next())), lastGood);
      expect(doc.extensions).toMatchObject([{ id: 'a', state: 'running', parts: ['api'] }]);
    }
  );

  it('a running child with a bad document is down and not listed; another id is refused', async () => {
    const bad = await child(200, '{"id":"a"}');
    const other = await child(200, JSON.stringify(docOf('b')));
    const entries = entriesOf(entryOf('a', 'running', bad), entryOf('c', 'running', other));
    expect((await hostDocumentOf(entries, new Map())).extensions).toEqual([]);
  });

  it('a row with no version yet and a disabled row are not listed', async () => {
    const none = { ...entryOf('a', 'failed'), version: '' };
    const doc = await hostDocumentOf(entriesOf(none, entryOf('b', 'disabled')), new Map());
    expect(doc.extensions).toEqual([]);
  });
});

const app = { title: 'A', entry: '/app/a/app-0123456789.js', css: '/app/a/app-0123456789.css' };
