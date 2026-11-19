import { describe, expect, it } from 'vitest';
import { type Child } from './child.js';
import { enter, laneOf, retire } from './lane.js';

// A child whose stop cuts at once: only the lane can keep an open request answered.
const childOf = (log: string[]): Child => ({
  port: 1,
  pid: 1,
  exited: new Promise(() => undefined),
  stop: async () => void log.push('stop'),
});

describe('retire', () => {
  it('stops the child only once the open requests left', async () => {
    const log: string[] = [];
    const lane = laneOf(childOf(log));
    const leave = enter(lane);
    const retired = retire(lane, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    log.push('left');
    leave();
    leave();
    await retired;
    expect(log).toEqual(['left', 'stop']);
    expect(lane.open).toBe(0);
  });

  it('a request that never leaves blocks the stop for drainMs only', async () => {
    const log: string[] = [];
    const lane = laneOf(childOf(log));
    enter(lane);
    const started = Date.now();
    await retire(lane, 100);
    expect(log).toEqual(['stop']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });
});
