import { describe, expect, it } from 'vitest';
import { cliUserSource, sessionOf, shownUserOf, type SignInSource } from './session.js';

const KEYS = ['host', 'signIn', 'signOut', 'user'];

describe('the session module (J.4.3 row 5)', () => {
  it('signed out on a machine: four keys, the sign-in page, no sign-out', () => {
    const session = sessionOf(cliUserSource({}));
    expect(Object.keys(session).sort()).toEqual(KEYS);
    expect(session).toEqual({
      host: { kind: 'local' },
      signIn: '/shell/sign-in',
      signOut: null,
      user: null,
    });
  });

  it('signed in on a machine: the user with the email of auth.json, no link', () => {
    const text = JSON.stringify({ user: { email: 'a@b.c', name: 'Not Sent', id: 'x' } });
    const session = sessionOf(cliUserSource({ sub: 'u_alice', text }));
    expect(Object.keys(session).sort()).toEqual(KEYS);
    expect(session).toMatchObject({ signIn: null, signOut: null });
    expect(session.user).toEqual({ id: 'u_alice', email: 'a@b.c' });
  });

  it('an auth.json that is not JSON, or an email that is not text, gives the sub alone', () => {
    expect(shownUserOf({ sub: 'u_a', text: '{' })).toEqual({ id: 'u_a' });
    expect(shownUserOf({ sub: 'u_a', text: '{"user":{"email":7}}' })).toEqual({ id: 'u_a' });
    expect(shownUserOf({ text: '{"user":{"email":"a@b.c"}}' })).toBeNull();
  });

  it('a source with a sign-out sends it only while signed in; the kind comes from the source', () => {
    const user = { id: 'u_b' };
    const cloud = (signedIn: boolean): SignInSource => ({
      kind: 'cloud',
      user: () => (signedIn ? user : null),
      signIn: 'https://auth.test/sign-in',
      signOut: '/shell/sign-out',
    });
    expect(sessionOf(cloud(true))).toEqual({
      host: { kind: 'cloud' },
      signIn: null,
      signOut: '/shell/sign-out',
      user,
    });
    expect(sessionOf(cloud(false))).toMatchObject({
      signIn: 'https://auth.test/sign-in',
      signOut: null,
    });
  });
});
