import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allPartsPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import type * as PgliteStore from '../store/pglite-store.js';
import type * as Scheduler from '../worker/scheduler.js';
import { hostExtension, JOB_STOP_MS } from './host-extension.js';

const order = vi.hoisted(() => [] as string[]);
// A job that never ends: its scheduler's stop never resolves.
const hung = vi.hoisted(() => ({ on: false }));

vi.mock('../worker/scheduler.js', async (actual) => {
  const real = await actual<typeof Scheduler>();
  const createScheduler: typeof real.createScheduler = (deps) => {
    const s = real.createScheduler(deps);
    const stop = () => (
      order.push('worker stop'),
      hung.on ? new Promise<void>(() => {}) : s.stop()
    );
    return { ...s, stop };
  };
  return { ...real, createScheduler };
});

vi.mock('../store/pglite-store.js', async (actual) => {
  const real = await actual<typeof PgliteStore>();
  const createPgliteStore: typeof real.createPgliteStore = (...args) => {
    const store = real.createPgliteStore(...args);
    return { ...store, close: () => (order.push('store close'), store.close()) };
  };
  return { ...real, createPgliteStore };
});

afterEach(() => {
  order.splice(0);
  hung.on = false;
  vi.restoreAllMocks();
});

const hostAll = async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const dataDir = join(await tempDir('agentage-host-order-'), 'all');
  return hostExtension(await allPartsPackage(), { dataDir, secrets: { 'tick-key': 'k' } });
};

describe('the host stops in order', () => {
  it('the worker stops before the store closes, once for two stop calls', async () => {
    const h = await hostAll();
    await Promise.all([h.stop(), h.stop()]);
    expect(order).toEqual(['worker stop', 'store close']);
  });

  it('a job that never ends holds the store close JOB_STOP_MS at most', async () => {
    const h = await hostAll();
    hung.on = true;
    const at = Date.now();
    await h.stop();
    expect(Date.now() - at).toBeGreaterThanOrEqual(JOB_STOP_MS - 50);
    expect(Date.now() - at).toBeLessThan(JOB_STOP_MS + 2_000);
    expect(order).toEqual(['worker stop', 'store close']);
  });
});
