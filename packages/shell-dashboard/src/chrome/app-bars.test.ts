import { describe, expect, it, vi } from 'vitest';
import { createAppBars } from './app-bars.js';

describe('app bars', () => {
  it('an equal page list changes nothing and tells nobody', () => {
    const bars = createAppBars();
    const listener = vi.fn();
    bars.subscribe(listener);
    bars.setPages('memory', [{ title: 'All', path: '' }]);
    const first = bars.snapshot();
    bars.setPages('memory', [{ title: 'All', path: '' }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bars.snapshot()).toBe(first);
    bars.setPages('memory', [{ title: 'All memories', path: '' }]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps a nav section per app; an equal one changes nothing, null clears it', () => {
    const bars = createAppBars();
    const listener = vi.fn();
    bars.subscribe(listener);
    const make = () => ({ title: 'Memories', items: [{ title: 'a', path: 'a', icon: 'folder' }] });
    bars.setSection('memory', make());
    const first = bars.snapshot();
    bars.setSection('memory', make());
    expect(bars.snapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(first.get('memory')?.section?.title).toBe('Memories');
    expect(first.get('other')?.section).toBeUndefined();
    bars.setSection('memory', { title: 'Memories', items: [{ title: 'b', path: 'a' }] });
    expect(listener).toHaveBeenCalledTimes(2);
    bars.setSection('memory', null);
    expect(bars.snapshot().get('memory')?.section).toBeNull();
    bars.setSection('memory', null);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
