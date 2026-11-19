import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeIssuer, signedInAuth } from '../../extension/src/test-support/fake-issuer.js';
import { guardOf } from '@agentage/extension/internal';
import { cliUserOf } from './cli-user.js';

const jwt = (claims: object) =>
  `aga_e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
const pat = (sub: unknown) => ({ id: 'p', token: jwt({ sub }), expiresAt: '2026-12-01T00:00:00Z' });

let auth: Awaited<ReturnType<typeof fakeIssuer>>;
beforeAll(async () => (auth = await fakeIssuer({ 'opaque-alice': 'u_alice' })));
afterAll(() => auth.close());

describe('cliUserOf', () => {
  it('right after sign-in (no platform token) asks the issuer for the session user', async () => {
    expect(await cliUserOf(signedInAuth(auth.issuer, 'opaque-alice'))).toBe('u_alice');
  });

  it('takes the platform token of its own issuer with no call, never of another', async () => {
    const before = auth.calls();
    const own = { platformPats: { [auth.issuer]: pat('u_pat') } };
    expect(await cliUserOf(signedInAuth(auth.issuer, 'x', own))).toBe('u_pat');
    expect(auth.calls()).toBe(before);
    const other = { platformPats: { 'https://other.test': pat('u_other') } };
    expect(await cliUserOf(signedInAuth(auth.issuer, 'opaque-alice', other))).toBe('u_alice');
    expect(await cliUserOf(signedInAuth(auth.issuer, 'gone', other))).toBeUndefined();
  });

  it.each([
    ['no file', ''],
    ['not JSON', '{'],
    [
      'no issuer (a session before cli 0.50.1)',
      JSON.stringify({ tokens: { accessToken: 'opaque-alice' } }),
    ],
    ['an issuer that is not an origin', signedInAuth('https://a.test/x', 'opaque-alice')],
    ['an issuer that does not answer', signedInAuth('http://127.0.0.1:9', 'opaque-alice')],
    [
      'a sub that is not one segment',
      signedInAuth('https://a.test', 'x', { platformPats: { 'https://a.test': pat('../etc') } }),
    ],
  ])('is no user on %s', async (_what, text) => {
    expect(await cliUserOf(text)).toBeUndefined();
  });
});

describe('guardOf and the cli user', () => {
  const env = { AGENTAGE_USER_SUB: 'u_a', AGENTAGE_HOST_AUTH: 'off' };

  it('acts as the user on loopback only, never with AGENTAGE_HOST_AUTH=off on every address', () => {
    expect(guardOf(env, { bind: '0.0.0.0', dir: '.' })).toBeUndefined();
    expect(guardOf({}, { bind: '127.0.0.1', dir: '.' })).toBeUndefined();
  });

  it('grants read and write; an admin route stays anonymous', async () => {
    const guard = guardOf(env, { bind: '127.0.0.1', dir: '.' });
    const pkg = { agentage: { id: 'memory' } } as Parameters<NonNullable<typeof guard>>[0];
    const check = (await guard?.(pkg, {} as never))?.tokenCheck;
    const user = { sub: 'u_a', scopes: ['memory:read', 'memory:write'] };
    expect(await check?.('Bearer other', 'write')).toEqual(user);
    expect(await check?.(undefined, 'admin')).toBeNull();
  });
});
