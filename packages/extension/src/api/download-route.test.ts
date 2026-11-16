import { Readable } from 'node:stream';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail } from '../envelope/envelope.js';
import { laneOf } from '../host/daemon/lane.js';
import { proxyTo } from '../host/daemon/proxy.js';
import { type Entry } from '../host/daemon/supervisor.js';
import { ErrorEnvelopeSchema } from '../envelope/envelope.schema.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { startOn, startTestServer, type TestServer } from '../testing/test-server.js';
import { download } from './download.js';
import { generatedOpenapi } from './openapi-doc.js';
import { createRouteRegistry, type ApiContext } from './routes.js';

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 255]);
const zip = { summary: 'Export', produces: 'application/zip' };

const failing = (after: Buffer[]) =>
  new Readable({
    read() {
      const next = after.shift();
      if (next) this.push(next);
      else this.destroy(new Error('disk gone'));
    },
  });

// The first chunk, then nothing: only a client that leaves ends it.
const held = new Readable({ read() {} });
held.push(Buffer.from('ab'));

const create = ({ route }: ApiContext) => {
  route('get', '/held', zip, () => download(held));
  route('get', '/export', zip, () => download(ZIP, { filename: 'memories.zip' }));
  route('get', '/stream', zip, () =>
    download(Readable.from([Buffer.from('ab'), Buffer.from('cd')]))
  );
  route('get', '/web', { summary: 'Web', produces: 'text/csv' }, () =>
    download(new Blob(['a,b\n1,2\n']).stream(), { contentType: 'text/csv; charset=utf-8' })
  );
  route('get', '/missing', zip, () => {
    throw fail('NOT_FOUND', 'No memory');
  });
  route('get', '/early', zip, () => download(failing([]), { filename: 'x.zip' }));
  route('get', '/late', zip, () => download(failing([Buffer.from('ab')])));
  route('get', '/json', zip, () => ({ not: 'a file' }) as never);
  route('get', '/undeclared', { summary: 'No produces' }, () => download('x'));
};

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const get = async (path: string) => {
  server ??= await startTestServer({ create });
  return server.fetch(`/api/test${path}`);
};

describe('a route that answers a file', () => {
  it('sends the bytes with its content type and an attachment name', async () => {
    const res = await get('/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename=memories.zip');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ZIP);
  });

  it('streams a node stream and a web stream', async () => {
    const stream = await get('/stream');
    expect([stream.headers.get('content-type'), await stream.text()]).toEqual([
      'application/zip',
      'abcd',
    ]);
    const web = await get('/web');
    expect([web.headers.get('content-type'), await web.text()]).toEqual([
      'text/csv; charset=utf-8',
      'a,b\n1,2\n',
    ]);
  });

  it('a failure before the first byte is the error envelope, no attachment', async () => {
    const missing = await get('/missing');
    expect(missing.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await missing.json()).error.code).toBe('NOT_FOUND');
    const early = await get('/early');
    expect(early.status).toBe(500);
    expect(early.headers.get('content-disposition')).toBeNull();
    expect(ErrorEnvelopeSchema.parse(await early.json()).error.code).toBe('INTERNAL');
  });

  it('a failure after the first byte cuts the answer', async () => {
    const late = await get('/late');
    expect(late.status).toBe(200);
    await expect(late.text()).rejects.toThrow();
  });

  it('a client that leaves mid-answer destroys the source', async () => {
    server = await startTestServer({ create });
    const leave = new AbortController();
    const res = await server.fetch('/api/test/held', { signal: leave.signal });
    await res.body?.getReader().read();
    leave.abort();
    await vi.waitFor(() => expect(held.destroyed).toBe(true));
  });

  it('a JSON answer to produces, or a file with no produces, is INTERNAL', async () => {
    expect((await get('/json')).status).toBe(500);
    expect((await get('/undeclared')).status).toBe(500);
  });
});

describe('a file through the daemon proxy', () => {
  it('keeps the bytes, the content type and the attachment name', async () => {
    server = await startTestServer({ create });
    const child = { port: Number(new URL(server.url).port), pid: 1, stop: async () => undefined };
    const entry: Entry = { id: 'test', install: { id: 'test' }, state: 'running', version: '1' };
    entry.lane = laneOf({ ...child, exited: new Promise<never>(() => undefined) });
    const proxy = proxyTo(new Map([['test', entry]]), { gateMs: 1_000, answerMs: 5_000 });
    const daemon = await startOn(express().use('/api/:id', proxy));
    const res = await daemon.fetch('/api/test/export');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename=memories.zip');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ZIP);
    await daemon.close();
  });
});

describe('produces in the registry and the contract', () => {
  const { route, routes } = createRouteRegistry();
  route('get', '/export', zip, () => download(ZIP));

  it.each([
    [{ produces: 'zip' }, 'produces zip'],
    [{ produces: 'application/zip', status: 201 }, 'produces a file'],
    [{ produces: 'application/zip', etag: true }, 'produces a file'],
  ])('refuses %j', (spec, message) => {
    const register = route as (...args: unknown[]) => void;
    expect(() => register('get', '/x', { summary: 'S', ...spec }, () => 1)).toThrow(message);
  });

  it('documents the media type, not the envelope', () => {
    const doc = generatedOpenapi(API_MANIFEST, routes) as {
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    const [operation] = Object.values(doc.paths);
    expect(operation?.get.responses['200']).toEqual({
      description: 'the file',
      content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
    });
  });
});
