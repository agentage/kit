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
});
