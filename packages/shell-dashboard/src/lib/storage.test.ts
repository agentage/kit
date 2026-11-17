// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStore, rootVarPx, writeStore } from './storage.js';

afterEach(() => vi.restoreAllMocks());

describe('storage', () => {
  it('reads and writes, and never throws when storage is blocked', () => {
    writeStore('k', 'v');
    expect(readStore('k')).toBe('v');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStore('k')).toBeNull();
    expect(() => writeStore('k', 'w')).not.toThrow();
  });

  it('reads a root px variable, clamped, with a fallback', () => {
    document.documentElement.style.setProperty('--w', '999px');
    expect(rootVarPx('--w', 10, 0, 500)).toBe(500);
    expect(rootVarPx('--none', 42, 0, 500)).toBe(42);
  });
});
