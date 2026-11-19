import { describe, expect, it } from 'vitest';
import * as internal from '../internal/index.js';

describe('kitShellDir (deprecated, for @agentage/apphost 0.1.0)', () => {
  it('is still exported from internal and names no folder, without a throw', () => {
    expect(typeof internal.kitShellDir).toBe('function');
    expect(internal.kitShellDir()).toBeUndefined();
  });
});
