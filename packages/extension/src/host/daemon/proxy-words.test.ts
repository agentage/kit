import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness } from '../../test-support/daemon-harness.js';
import { wordLaunch, wordPackage } from '../../test-support/word-launch.js';
import { createLog } from '../../log/log.js';
import { errorHandler } from '../../server/errors.js';
import { startOn } from '../../testing/test-server.js';
import { type Entries } from './entries.js';
import { proxyTo } from './proxy.js';
import { type Entry } from './supervisor.js';

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(() => vi.restoreAllMocks());

const errorOf = async (res: Response) => [
  res.status,
  ((await res.json()) as { error: object }).error,
];

describe('a 503 of the proxy says why there is no child', () => {
  it('held past gateMs by a change: "is changing", not "is running"', async () => {
    const entry: Entry = { id: 'slow', install: { id: 'slow' }, state: 'running', version: '1' };
    entry.gate = new Promise(() => undefined);
    const entries: Entries = new Map([['slow', entry]]);
    const app = express().use('/api/:id', proxyTo(entries, { gateMs: 50, answerMs: 1_000 }));
    app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
    const server = await startOn(app);
    expect(await errorOf(await server.fetch('/api/slow/echo'))).toMatchObject([
      503,
      { code: 'UNAVAILABLE', message: 'slow is changing: try again' },
    ]);
    await server.close();
  });

  it('starting or failed: its state, with Retry-After', async () => {
    const at = (state: Entry['state']): Entry => ({
      id: 'x',
      install: { id: 'x' },
      state,
      version: '1',
    });
    for (const state of ['starting', 'failed'] as const) {
      const app = express().use(
        '/api/:id',
        proxyTo(new Map([['x', at(state)]]), { gateMs: 50, answerMs: 1_000 })
      );
      app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
      const server = await startOn(app);
      const res = await server.fetch('/api/x/echo');
      expect(res.headers.get('retry-after')).toBe('5');
      expect(await errorOf(res)).toMatchObject([503, { message: `x is ${state}: try again` }]);
      await server.close();
    }
  });

  it('while the daemon stops: "the daemon stops", on /api and /mcp', async () => {
    const h = await startHarness({ launch: wordLaunch(400).launch });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    const stopped = h.daemon.stop();
    for (const path of ['/api/word/x', '/mcp/word'])
      expect(await h.call('GET', path)).toMatchObject({
        status: 503,
        body: { error: { code: 'UNAVAILABLE', message: 'the daemon stops' } },
      });
    await stopped;
  });
});
