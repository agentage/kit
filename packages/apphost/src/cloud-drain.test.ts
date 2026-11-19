import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAIN_MS, GRACE_MS, stopOnSignal } from './cloud-drain.js';
import { cloudLog } from './cloud-host.js';
import {
  callAt,
  closeUpstreams,
  cloudEnv,
  startCloud,
  type Started,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

describe('drain on SIGTERM', () => {
  it('/health 503 with Connection: close while draining, then the port closes', async () => {
    host = await startCloud(await cloudEnv({ extensions: [], upstreams: [] }), { drainMs: 50 });
    const { port } = host;
    const draining = host.drain();
    const res = await callAt(port, '/health');
    expect([res.status, res.headers.connection, res.headers['retry-after']]).toEqual([
      503,
      'close',
      '5',
    ]);
    await draining;
    await expect(callAt(port, '/health')).rejects.toThrow();
    host = undefined;
  });

  it('the drain fits in the stop grace: exit 0 when it ends, 1 when the grace runs out', async () => {
    expect([DRAIN_MS, GRACE_MS]).toEqual([5_000, 10_000]);
    const codes: number[] = [];
    stopOnSignal({ drain: async () => undefined }, (code) => void codes.push(code), 1_000)();
    stopOnSignal(
      { drain: () => new Promise(() => undefined) },
      (code) => void codes.push(code),
      20
    )();
    await vi.waitFor(() => expect(codes).toEqual([0, 1]));
  });
});

describe('logs redact URL credentials (through the kit logger)', () => {
  it('scheme://user:pass@ is ***@ in the message and in every field', () => {
    const lines: string[] = [];
    const log = cloudLog('1.0.0', (line) => void lines.push(line));
    log.warn('cannot reach postgres://app:s3cret@db:5432/x', { store: 'http://u:pw@store:8123/' });
    expect(lines.join('')).not.toMatch(/s3cret|:pw@/);
    expect(lines.join('')).toContain('postgres://***@db:5432/x');
    expect(lines.join('')).toContain('http://***@store:8123/');
  });

  it('an error a start refusal logs is masked too', () => {
    const lines: string[] = [];
    cloudLog('1.0.0', (line) => void lines.push(line)).error(new Error('bad https://a:b@c.io/'));
    expect(lines.join('')).toContain('https://***@c.io/');
    expect(lines.join('')).not.toContain('a:b@');
  });
});
