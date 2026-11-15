import express from 'express';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startHarness } from '../../test-support/daemon-harness.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { errorHandler } from '../../server/errors.js';
import { startOn } from '../../testing/test-server.js';
import { createLog } from '../../log/log.js';
import { type Entries } from './ops.js';
import { endToEnd, proxyTo } from './proxy.js';

// The in-process child stops at once only with no store open; a hung handler holds no PGlite.
const NO_STORE = {
  ...HOSTED_MANIFEST,
  agentage: { ...HOSTED_MANIFEST.agentage, parts: { api: true } },
};
import { type Entry } from './supervisor.js';

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
    const app = express().use('/api/:id', proxyTo(entries, 50));
    app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
    const server = await startOn(app);
    const res = await server.fetch('/api/slow/echo');
    expect([res.status, await res.json()]).toMatchObject([503, { error: { code: 'UNAVAILABLE' } }]);
    await server.close();
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
    await writeFile(join(h.configDir, 'secrets.json'), json({ hosted: { 'api-token': 't' } }));
    await h.call('POST', '/host/extensions', { source: await hostedPackage(NO_STORE) });
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
