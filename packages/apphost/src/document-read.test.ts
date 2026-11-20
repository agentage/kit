// The stub router's discovery.test.mjs (apphosts), ported: the limits of the document read.
import { type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudDiscovery } from './cloud-discovery.js';
import { MAX_DOC_BYTES, readDocument } from './document-read.js';
import { type Entries } from './entries.js';
import { type Lane } from './lane.js';
import { closeUpstreams, docOf, OWN, quietLog, upstream } from './test-support/cloud-upstream.js';

afterEach(closeUpstreams);

const entriesAt = (id: string, address: string): Entries => {
  const lane = { child: { addresses: () => [address] } } as unknown as Lane;
  return new Map([[id, { id, install: { id }, state: 'running', version: '1.0.0', lane }]]);
};

const stateAfterRead = async (address: string) => {
  const installation = { host: 'site', extensions: [{ id: 'fixture', version: '1.0.0' }] };
  const entries = entriesAt('fixture', address);
  const d = createCloudDiscovery({
    installation,
    entries,
    own: OWN,
    log: quietLog(),
    onChange: vi.fn(),
  });
  await d.refresh();
  return d.current().document.extensions[0]?.state;
};

const TOTAL = 16 * 1024 * 1024;
const CHUNK = Buffer.alloc(64 * 1024, 'x');

// Writes a JSON string of TOTAL bytes in chunks until done or the client closes the socket.
const streamBig = (res: ServerResponse, out: { sent: number; closed: boolean; done: boolean }) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.on('close', () => (out.closed = !out.done));
  res.write('{"pad":"');
  const next = () => {
    if (res.destroyed) return;
    if (out.sent >= TOTAL) return void ((out.done = true), res.end('"}'));
    out.sent += CHUNK.length;
    res.write(CHUNK, () => setImmediate(next));
  };
  next();
};

describe('a document over the size limit', () => {
  it('is refused and its read is cut: the client closes, the rest is never sent', async () => {
    const out = { sent: 0, closed: false, done: false };
    const up = await upstream(undefined);
    up.custom = (_req, res) => (streamBig(res, out), true);
    const read = await readDocument(up.address, 5_000);
    expect(read).toBeUndefined();
    await vi.waitFor(() => expect(out.closed).toBe(true));
    expect(out.sent).toBeGreaterThan(MAX_DOC_BYTES);
    expect(out.sent).toBeLessThan(TOTAL / 2);
    expect(await stateAfterRead(up.address)).toBe('starting');
  });
});

describe.each([204, 304])('a container that answers %i to the document read', (status) => {
  it('gives no document and never throws; the row stays starting', async () => {
    const up = await upstream(undefined);
    up.custom = (_req, res) => (res.writeHead(status).end(), true);
    await expect(readDocument(up.address, 1_000)).resolves.toBeUndefined();
    expect(await stateAfterRead(up.address)).toBe('starting');
  });
});

describe('a document of the limit size or under', () => {
  it('is read', async () => {
    const up = await upstream(docOf('fixture'));
    expect(await readDocument(up.address, 1_000)).toMatchObject({ id: 'fixture' });
  });
});
