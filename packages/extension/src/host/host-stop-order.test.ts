import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allPartsPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import type * as PgliteStore from '../store/pglite-store.js';
import type * as Scheduler from '../worker/scheduler.js';
import { hostExtension } from './host-extension.js';

const order = vi.hoisted(() => [] as string[]);

vi.mock('../worker/scheduler.js', async (actual) => {
  const real = await actual<typeof Scheduler>();
  const createScheduler: typeof real.createScheduler = (deps) => {
    const s = real.createScheduler(deps);
    return { ...s, stop: () => (order.push('worker stop'), s.stop()) };
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

afterEach(() => vi.restoreAllMocks());

describe('the host stops in order', () => {
  it('the worker stops before the store closes, once for two stop calls', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dataDir = join(await tempDir('agentage-host-order-'), 'all');
    const h = await hostExtension(await allPartsPackage(), {
      dataDir,
      secrets: { 'tick-key': 'k' },
    });
    await Promise.all([h.stop(), h.stop()]);
    expect(order).toEqual(['worker stop', 'store close']);
  });
});
