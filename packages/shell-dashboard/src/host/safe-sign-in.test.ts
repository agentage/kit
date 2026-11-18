import { describe, expect, it } from 'vitest';
import { safePath, safeSignIn } from './safe-sign-in.js';

const PAGE = 'https://h.test';

describe('safeSignIn', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/x',
    '/\\evil.example',
    '/\t/evil.example',
    'http://auth.example/sign-in',
    'sign-in',
    '',
  ])('refuses %j on an https page', (value) => {
    expect(safeSignIn(value, PAGE)).toBeUndefined();
  });

  it.each([undefined, null, 42, {}, ['/x']])('refuses the non-string %j', (value) => {
    expect(safeSignIn(value, PAGE)).toBeUndefined();
  });

  it.each(['https://auth.agentage.io/sign-in?next=https%3A%2F%2Fh.test%2F', '/__sign-in?next=%2F'])(
    'keeps %j',
    (value) => {
      expect(safeSignIn(value, PAGE)).toBe(value);
    }
  );

  it('keeps the daemon page /shell/sign-in on loopback http; refuses lookalikes', () => {
    const daemon = 'http://127.0.0.1:4243';
    expect(safeSignIn('/shell/sign-in', daemon)).toBe('/shell/sign-in');
    for (const value of ['//shell/sign-in', '/\\shell/sign-in', 'file:///shell/sign-in'])
      expect(safeSignIn(value, daemon), value).toBeUndefined();
  });

  it('keeps an http link only when the page is on loopback http', () => {
    const link = 'http://127.0.0.1:4243/sign-in';
    expect(safeSignIn(link, 'http://127.0.0.1:4243')).toBe(link);
    expect(safeSignIn(link, 'http://localhost:3000')).toBe(link);
    expect(safeSignIn(link, 'http://h.test')).toBeUndefined();
    expect(safeSignIn('javascript:alert(1)', 'http://localhost:3000')).toBeUndefined();
  });
});

describe('safePath', () => {
  it.each([
    '//evil.test/x',
    'https://evil.test/x',
    'https://h.test/shell/sign-out',
    'javascript:alert(1)',
    '/\\evil.test',
    '/\t/evil.test',
    'sign-out',
    '',
    undefined,
    42,
  ])('refuses %j', (value) => {
    expect(safePath(value, PAGE)).toBeUndefined();
  });

  it('keeps a same-origin path', () => {
    expect(safePath('/shell/sign-out', PAGE)).toBe('/shell/sign-out');
  });
});
