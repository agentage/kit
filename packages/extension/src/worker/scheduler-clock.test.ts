import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { parseClockRate } from './clock.js';
import { memoryRuns } from './runs.js';
import { createScheduler } from './scheduler.js';

afterEach(() => void vi.useRealTimers());

describe('test clock', () => {
  it('runs a every-minute job 3 times in under 4 s of real time at rate 60', async () => {
    const t0 = Date.now();
    const s = createScheduler({ runs: memoryRuns(), log: recordedLog().log, clockRate: 60 });
    let active = 0;
    let overlap = false;
    const runs: number[] = [];
    s.schedule('tick', '* * * * *', async () => {
      overlap ||= ++active > 1;
      runs.push(Date.now() - t0);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
    s.start();
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(3), { timeout: 3900 });
    s.stop();
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(overlap).toBe(false);
  });

  it('rate 1 keeps real time: one cron minute is one real minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-05T10:00:30Z') });
    const s = createScheduler({ runs: memoryRuns(), log: recordedLog().log, clockRate: 1 });
    const job = vi.fn();
    s.schedule('tick', '* * * * *', job);
    s.start();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(job).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('never twice at once under a fast clock: a slow run makes the next tick skip', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-05T10:00:30Z') });
    const s = createScheduler({ runs: memoryRuns(), log: recordedLog().log, clockRate: 60 });
    let active = 0;
    let max = 0;
    s.schedule('slow', '* * * * *', async () => {
      max = Math.max(max, ++active);
      await new Promise((r) => setTimeout(r, 3_000));
      active--;
    });
    s.start();
    await vi.advanceTimersByTimeAsync(8_000);
    s.stop();
    expect(max).toBe(1);
  });

  it('refuses a bad rate with a clear message', () => {
    for (const bad of ['0', '0.5', '-1', 'abc', '3601', 'Infinity']) {
      expect(() => parseClockRate(bad)).toThrow(
        /AGENTAGE_CLOCK_RATE must be a number from 1 to 3600/
      );
    }
    expect(parseClockRate(undefined)).toBe(1);
    expect(parseClockRate('60')).toBe(60);
    expect(() =>
      createScheduler({ runs: memoryRuns(), log: recordedLog().log, clockRate: 0 })
    ).toThrow(/AGENTAGE_CLOCK_RATE/);
  });
});
