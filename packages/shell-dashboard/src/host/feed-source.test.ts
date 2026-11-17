import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFeed } from './feed-source.js';
import { fakeHost } from '../test-support/fake-host.js';

const fire = (s: { listeners: Map<string, Set<(e: MessageEvent<string>) => void>> }, t: string) =>
  s.listeners.get(t)?.forEach((fn) => fn(new MessageEvent(t)));

const setup = () => {
  const host = fakeHost({ host: 'local', extensions: [] });
  const wired = vi.fn();
  const stop = openFeed(host.deps.events, '/shell/events', wired);
  return { host, wired, stop, last: () => host.sources.at(-1)! };
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('openFeed', () => {
  it('a closed source is replaced after 1 s, then 2 s, wired the same', () => {
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
    vi.advanceTimersByTime(1999);
    expect(host.sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(host.sources).toHaveLength(3);
  });

  it('the back-off caps at 30 s', () => {
    const { host, last } = setup();
    for (let i = 0; i < 8; i++) {
      last().readyState = 2;
      fire(last(), 'error');
      vi.advanceTimersByTime(30_000);
    }
    const n = host.sources.length;
    last().readyState = 2;
    fire(last(), 'error');
    vi.advanceTimersByTime(29_999);
    expect(host.sources).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(host.sources).toHaveLength(n + 1);
  });

  it('open resets the back-off', () => {
    const { host, last } = setup();
    for (let i = 0; i < 3; i++) {
      last().readyState = 2;
      fire(last(), 'error');
      vi.advanceTimersByTime(30_000);
    }
    fire(last(), 'open');
    last().readyState = 2;
    fire(last(), 'error');
    vi.advanceTimersByTime(1000);
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
});
