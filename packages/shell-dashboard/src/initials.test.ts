// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initials } from './shell-ports.js';

describe('initials', () => {
  it('takes two words, else two letters of the email name', () => {
    expect(initials('Alex Doe')).toBe('AD');
    expect(initials('lab@example.test')).toBe('LA');
    expect(initials('jane.roe@x.test')).toBe('JR');
    expect(initials(null)).toBe('?');
  });
});
