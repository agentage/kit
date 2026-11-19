import { describe, expect, it } from 'vitest';
import { redact } from './start-checks.js';

describe('redact', () => {
  it('hides each value of 4 or more characters, the longest first; shorter ones stay', () => {
    const secrets = { a: 'abcd', b: 'abcdefgh', c: 'xyz' };
    expect(redact('abcdefgh then abcd then xyz', secrets)).toBe('*** then *** then xyz');
  });
});
