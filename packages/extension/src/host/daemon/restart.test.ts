import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from './limits.js';
import { serialQueue } from './queue.js';
import { cancelRestart, crashed, resetRestarts, restartsOf } from './restart.js';
import { stoppingOf } from './stopping.js';
import { type Entry, type SupervisorDeps } from './supervisor.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const depsOf = (abort = new AbortController()) =>
  ({
    ...LIMITS,
    log,
    queue: serialQueue(),
    stopping: stoppingOf(abort.signal),
  }) as unknown as SupervisorDeps;
const entryOf = (): Entry => ({
  id: 'crash',
  install: { id: 'crash', source: '/x' },
  state: 'running',
  version: '1.0.0',
});

// Each restart "starts" and exits again at once: the delays the entry waited, in order.
const loop = (deps: SupervisorDeps, entry: Entry) => {
  const starts: number[] = [];
  const again = async () => {
    starts.push(Date.now());
    crashed(deps, entry, 'crash on purpose', again);
  };
  return { starts, again };
};

beforeEach(() => void vi.useFakeTimers({ now: 0 }));
afterEach(() => void vi.useRealTimers());

describe('restart with backoff (C6)', () => {
  it('restarts after 1, 2, 4, 8 s; the fifth exit in 10 min is failed with the last words', async () => {
    const deps = depsOf();
    const entry = entryOf();
    const { starts, again } = loop(deps, entry);
    crashed(deps, entry, 'crash on purpose', again);
    expect(entry).toMatchObject({
      state: 'starting',
      error: 'crash on purpose: restart in 1000 ms',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(starts).toEqual([1_000, 3_000, 7_000, 15_000]);
    expect(restartsOf(entry)).toBe(4);
    expect(entry).toMatchObject({
      state: 'failed',
      error: 'exited 5 times in 10 min: crash on purpose',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(4);
  });

  it('waits 16 s once an old exit left the window, and the 16 s repeats', async () => {
    const deps = depsOf();
    const entry = { ...entryOf(), restarts: 4, exits: [0, 1, 2] };
    vi.setSystemTime(700_000);
    const { starts, again } = loop(deps, entry);
    crashed(deps, entry, 'late', again);
    expect(entry.error).toBe('late: restart in 16000 ms');
    await vi.advanceTimersByTimeAsync(16_000);
    expect(starts).toEqual([716_000]);
    expect(entry.error).toBe('crash on purpose: restart in 16000 ms');
  });

  it('a reset (enable, update, configure, reload) starts the count and the backoff again', async () => {
    const deps = depsOf();
    const entry = entryOf();
    const { again } = loop(deps, entry);
    crashed(deps, entry, 'x', again);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(restartsOf(entry)).toBe(2);
    resetRestarts(entry);
    expect([restartsOf(entry), entry.exits, entry.retry]).toEqual([0, [], undefined]);
    crashed(deps, entry, 'x', async () => undefined);
    expect(entry.error).toBe('x: restart in 1000 ms');
  });

  it('a cancel, a lane, a disable or a daemon stop before the timer fires: no restart', async () => {
    const abort = new AbortController();
    const deps = depsOf(abort);
    const again = vi.fn(async () => undefined);
    const cases: ((entry: Entry) => void)[] = [
      (entry) => cancelRestart(entry),
      (entry) => (entry.lane = { child: {} as never, open: 0, idle: [] }),
      (entry) => (entry.install = { ...entry.install, enabled: false }),
    ];
    for (const change of cases) {
      const entry = entryOf();
      crashed(deps, entry, 'x', again);
      change(entry);
    }
    const last = entryOf();
    crashed(deps, last, 'x', again);
    abort.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(again).not.toHaveBeenCalled();
  });

  it('runs in the change queue: a change that holds the queue goes first', async () => {
    const deps = depsOf();
    const entry = entryOf();
    const order: string[] = [];
    crashed(deps, entry, 'x', async () => void order.push('restart'));
    let free = () => undefined as void;
    void deps.queue(() => new Promise<void>((resolve) => (free = resolve)));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(order).toEqual([]);
    order.push('change');
    free();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['change', 'restart']);
  });
});
