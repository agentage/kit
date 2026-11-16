import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { allPartsPackage } from '../../test-support/hosted-fixture.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

// Over the kit's BODY_LIMIT (1 MB): the child refuses it, the daemon relays that answer whole.
const BIG = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) });
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('a body over the limit through the proxy', () => {
  it('is 413 PAYLOAD_TOO_LARGE in the envelope on /api/{id} and /mcp/{id}; the child runs on', async () => {
    h = await startHarness();
    const secrets = { all: { 'tick-key': 'k' } };
    await writeFile(join(h.configDir, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });
    await h.call('POST', '/host/extensions', { source: await allPartsPackage() });
    for (const path of ['/api/all/ticks', '/mcp/all']) {
      const res = await fetch(`http://127.0.0.1:${h.daemon.port}${path}`, {
        method: 'POST',
        headers: HEADERS,
        body: BIG,
      });
      const body = (await res.json()) as { error: object };
      expect([path, res.status, body.error]).toMatchObject([
        path,
        413,
        { code: 'PAYLOAD_TOO_LARGE' },
      ]);
    }
    expect((await h.call('GET', '/api/all/ticks')).status).toBe(200);
  });
});
