import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from './test-support/daemon-harness.js';
import { wordPackage } from './test-support/word-launch.js';
import { type Exit, type Launch } from './child.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

// A child that exits as soon as its /health answer is sent: before the daemon reads that answer.
const goneAfterHealth: Launch = async () => {
  let done = (_how: Exit) => undefined as void;
  const exited = new Promise<Exit>((resolve) => (done = resolve));
  const server = createServer((_req, res) => {
    res.on('finish', () => {
      server.close();
      done({ code: 1, signal: null, words: 'gone after health' });
    });
    res.setHeader('content-type', 'application/json').end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, pid: 1, exited, stop: async () => void (await exited) };
};

describe('an exit that comes before the daemon gives the child the route (C6)', () => {
  it('is counted, never lost: the row is failed, not running with a dead child', async () => {
    h = await startHarness({ launch: goneAfterHealth, crashLimit: 1 });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    const rowOf = async () =>
      ((await h!.call('GET', '/host/extensions')).body as { data: object[] }).data[0];
    await vi.waitFor(
      async () =>
        expect(await rowOf()).toMatchObject({
          state: 'failed',
          error: 'exited 1 times in 10 min: gone after health',
        }),
      { timeout: 5_000, interval: 50 }
    );
  });
});
