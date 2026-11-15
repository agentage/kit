import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './index.js';

describe('CAPABILITIES', () => {
  it('names container and local-guard, and cannot change', () => {
    expect(CAPABILITIES).toEqual(['container', 'local-guard']);
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
  });
});
