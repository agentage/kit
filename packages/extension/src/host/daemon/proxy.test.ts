import express from 'express';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../server/errors.js';
import { startOn } from '../../testing/test-server.js';
import { createLog } from '../../log/log.js';
import { type Entries } from './ops.js';
import { proxyTo } from './proxy.js';
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
