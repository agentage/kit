import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthBody } from '../health/health.js';
import { hostClockRate, setHostClockRate } from '../worker/clock.js';
import { startHostClock } from './clock-rate.js';

afterEach(() => {
  setHostClockRate(1);
  vi.restoreAllMocks();
});

describe('host test clock', () => {
  it('reads the env once, sets the rate and warns on one line', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(startHostClock({ AGENTAGE_CLOCK_RATE: '60' })).toBe(60);
    expect(hostClockRate()).toBe(60);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('is silent at rate 1 and refuses a bad value', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(startHostClock({})).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(() => startHostClock({ AGENTAGE_CLOCK_RATE: 'fast' })).toThrow(/AGENTAGE_CLOCK_RATE/);
  });

  it('/health body carries clockRate only when it is not 1', async () => {
    const base = {
      extension: 'probe',
      part: 'api' as const,
      version: '0.1.0',
      build: { commit: '0000000', buildTime: '2026-11-05T10:00:00Z' },
      instance: 'abcdef01',
      startedAt: Date.now(),
    };
    expect((await healthBody({ ...base, clockRate: 60 })).data).toMatchObject({ clockRate: 60 });
    expect((await healthBody({ ...base, clockRate: 1 })).data).not.toHaveProperty('clockRate');
  });
});
