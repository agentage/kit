import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFeed } from './feed-source.js';
import { fakeHost } from '../test-support/fake-host.js';

const fire = (s: { listeners: Map<string, Set<(e: MessageEvent<string>) => void>> }, t: string) =>
  s.listeners.get(t)?.forEach((fn) => fn(new MessageEvent(t)));

const setup = (random = () => 0) => {
  const host = fakeHost({ host: 'local', extensions: [] });
  const wired = vi.fn();
  const stop = openFeed(host.deps.events, '/shell/events', wired, random);
  return { host, wired, stop, last: () => host.sources.at(-1)! };
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('openFeed', () => {
  it('a closed source is replaced after the 1 s floor each time with no jitter, wired the same', () => {
    const { host, wired, last } = setup();
    last().readyState = 2;
    fire(last(), 'error');
    vi.advanceTimersByTime(999);
    expect(host.sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(host.sources).toHaveLength(2);
    expect(wired).toHaveBeenCalledTimes(2);
    last().readyState = 2;
    fire(last(), 'error');
    vi.advanceTimersByTime(999);
    expect(host.sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(host.sources).toHaveLength(3);
  });

  it('the back-off span doubles and caps at 30 s', () => {
    const { host, last } = setup(() => 0.99999);
    for (let i = 0; i < 8; i++) {
      last().readyState = 2;
      fire(last(), 'error');
      vi.advanceTimersByTime(30_000);
    }
    const n = host.sources.length;
    last().readyState = 2;
    fire(last(), 'error');
    vi.advanceTimersByTime(29_998);
    expect(host.sources).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(host.sources).toHaveLength(n + 1);
  });

  it('open resets the back-off', () => {
    const { host, last } = setup(() => 0.99999);
    for (let i = 0; i < 3; i++) {
      last().readyState = 2;
      fire(last(), 'error');
      vi.advanceTimersByTime(30_000);
    }
    fire(last(), 'open');
    last().readyState = 2;
    fire(last(), 'error');
    vi.advanceTimersByTime(1998);
    expect(host.sources).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(host.sources).toHaveLength(5);
  });

  it('an error on a source that is not closed creates nothing', () => {
    const { host, last } = setup();
    last().readyState = 0;
    fire(last(), 'error');
    vi.advanceTimersByTime(60_000);
    expect(host.sources).toHaveLength(1);
    expect(host.state.closed).toBe(0);
  });

  it('cleanup closes the source and clears a pending timer', () => {
    const { host, stop, last } = setup();
    last().readyState = 2;
    fire(last(), 'error');
    stop();
    vi.advanceTimersByTime(60_000);
    expect(host.sources).toHaveLength(1);
    const again = setup();
    again.stop();
    expect(again.host.state.closed).toBe(1);
  });

  // The delay each client asks of setTimeout for its retries, with its own random source.
  const waits = (random: () => number, errors: number) => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { last } = setup(random);
    for (let i = 0; i < errors; i++) {
      last().readyState = 2;
      fire(last(), 'error');
      vi.advanceTimersByTime(30_000);
    }
    const ms = spy.mock.calls.map((c) => c[1]);
    spy.mockRestore();
    return ms;
  };

  it('two clients cut off by the same deploy do not retry at the same moment', () => {
    const a = waits(() => 0.1, 3);
    const b = waits(() => 0.7, 3);
    expect(a).toEqual([1100, 1300, 1700]);
    expect(b).toEqual([1700, 3100, 5900]);
    a.forEach((ms, i) => expect(ms).not.toBe(b[i]));
  });

  it('with Math.random every wait stays from 1 s to 30 s', () => {
    const ms = waits(Math.random, 40);
    expect(ms).toHaveLength(40);
    for (const m of ms) expect(m).toBeGreaterThanOrEqual(1000);
    for (const m of ms) expect(m).toBeLessThan(30_000);
  });
});
