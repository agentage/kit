import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotices, HISTORY_MAX, unreadOf } from './notices.js';

afterEach(() => vi.useRealTimers());

describe('notices', () => {
  it('keeps the history newest first, with the app and time; it does not expire', () => {
    vi.useFakeTimers();
    let t = 1000;
    const notices = createNotices(() => t);
    const seen = vi.fn();
    const off = notices.subscribe(seen);
    notices.push('probe', { text: 'one', kind: 'ok' });
    t = 2000;
    notices.push('probe', { text: 'two' });
    vi.advanceTimersByTime(60_000);
    expect(notices.list().map((n) => n.text)).toEqual(['two', 'one']);
    expect(notices.list()[1]).toMatchObject({ app: 'probe', kind: 'ok', at: 1000, read: false });
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    notices.push('probe', { text: 'three' });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('marks all read once; the snapshot stays the same object until a change', () => {
    const notices = createNotices();
    notices.push('a', { text: 'x' });
    notices.push('a', { text: 'y' });
    expect(unreadOf(notices.list())).toBe(2);
    expect(notices.list()).toBe(notices.list());
    notices.markAllRead();
    const after = notices.list();
    expect(unreadOf(after)).toBe(0);
    notices.markAllRead();
    expect(notices.list()).toBe(after);
  });

  it('tells onPush each new notice once; the history keeps the last 100', () => {
    const notices = createNotices();
    const pushed = vi.fn();
    notices.onPush(pushed);
    for (let i = 0; i < HISTORY_MAX + 5; i++) notices.push('a', { text: String(i) });
    expect(pushed).toHaveBeenCalledTimes(HISTORY_MAX + 5);
    expect(notices.list()).toHaveLength(HISTORY_MAX);
    expect(notices.list()[0]?.text).toBe(String(HISTORY_MAX + 4));
  });
});
