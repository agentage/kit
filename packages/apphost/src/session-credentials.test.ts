import { describe, expect, it } from 'vitest';
import {
  addressOf,
  credentialOf,
  foreignPage,
  sessionCookies,
  withoutCredentials,
} from './cloud-credentials.js';
import { createCloudSession } from './cloud-session.js';
import { fakeAuth, ISSUER } from './test-support/cloud-host.js';

const OWN = 'https://platform-host.next.agentage.io';
const SESSION = 'better-auth.session_token=s1.sig';

describe('the credential filter of the cloud session (J.4.4 row 2)', () => {
  it('only the auth session cookies leave the router', () => {
    expect(
      sessionCookies('a=1; better-auth.session_token=t; _ga=2; __Secure-better-auth.session_data=d')
    ).toBe('better-auth.session_token=t; __Secure-better-auth.session_data=d');
    expect(sessionCookies(undefined)).toBe('');
  });

  it('withoutCredentials keeps other cookies, a PAT and git Basic', () => {
    const h = (cookie: string, authorization: string) =>
      withoutCredentials({ accept: '*/*', cookie, authorization });
    expect(h(`a=1; ${SESSION}; __Secure-better-auth.session_data=d`, 'Basic eDp5')).toEqual({
      accept: '*/*',
      cookie: 'a=1',
      authorization: 'Basic eDp5',
    });
    expect(h(SESSION, 'Bearer opaque')).toEqual({ accept: '*/*' });
    expect(h('', 'Bearer aga_pat')).toEqual({ accept: '*/*', authorization: 'Bearer aga_pat' });
  });

  it('the filter drops every better-auth cookie, any prefix', () => {
    const cookie =
      'a=1; better-auth.dont_remember=x; __Host-better-auth.session_token=y; __Secure-better-auth-state=z';
    expect(withoutCredentials({ cookie })).toEqual({ cookie: 'a=1' });
  });

  it('the credential: a non-PAT bearer, else the session cookies; a PAT or nothing is none', () => {
    const of = (headers: Record<string, string>) => credentialOf({ headers });
    expect(of({ authorization: 'Bearer oauth-opaque', cookie: SESSION })).toEqual({
      authorization: 'Bearer oauth-opaque',
    });
    expect(of({ cookie: `_ga=1; ${SESSION}` })).toEqual({ cookie: SESSION });
    expect(of({ authorization: 'Bearer aga_pat', cookie: SESSION })).toBeNull();
    expect(of({ cookie: '_ga=1' })).toBeNull();
    expect(of({})).toBeNull();
  });

  it('a sibling page is foreign; the own origin, same-origin and a typed URL are not', () => {
    const of = (headers: Record<string, string>) => foreignPage({ headers }, OWN);
    expect(of({ origin: 'https://probe.next.agentage.io' })).toBe(true);
    expect(of({ 'sec-fetch-site': 'same-site' })).toBe(true);
    expect(of({ 'sec-fetch-site': 'cross-site', origin: OWN })).toBe(true);
    expect(of({ 'sec-fetch-site': 'same-origin', origin: OWN })).toBe(false);
    expect(of({ 'sec-fetch-site': 'none' })).toBe(false);
    expect(of({})).toBe(false);
  });

  it('the address is the last forwarded entry, else the socket address', () => {
    const socket = { remoteAddress: '10.0.0.9' };
    expect(addressOf({ headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' }, socket })).toBe(
      '9.9.9.9'
    );
    expect(addressOf({ headers: { 'x-forwarded-for': ' , ' }, socket })).toBe('10.0.0.9');
    expect(addressOf({ headers: {} })).toBe('');
  });

  it('headersFor itself drops the session cookie before the upstream and keeps a PAT', async () => {
    const session = createCloudSession({
      issuer: ISSUER,
      own: OWN,
      host: 'platform',
      fetcher: fakeAuth().fetcher,
    });
    const page = { 'sec-fetch-site': 'same-origin', cookie: `_ga=1; ${SESSION}` };
    expect(await session.headersFor({ headers: page }, 'market')).toEqual({
      'sec-fetch-site': 'same-origin',
      cookie: '_ga=1',
      authorization: 'Bearer aga_market.jwt',
    });
    const pat = { cookie: SESSION, authorization: 'Bearer aga_pat' };
    expect(await session.headersFor({ headers: pat }, 'market')).toEqual({
      authorization: 'Bearer aga_pat',
    });
  });
});
