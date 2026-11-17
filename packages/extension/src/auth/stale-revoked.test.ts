import { SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import {
  AUDIENCE,
  claimsOf,
  ORIGIN,
  startIssuer,
  type TestIssuer,
} from '../test-support/issuer.js';
import { authEnv, partPackage, startPart, STOP } from '../test-support/part-fixture.js';
import { createRevokedList } from './revoked.js';
import { type Access, type TokenCheck } from './token-check.js';
import { createTokenCheck, remoteKeys } from './verify-token.js';

const STALE_MS = 5 * 60_000;
const STALE = { code: 'UNAVAILABLE', status: 503, message: 'Revoked list stale', retryAfter: 5 };

let issuer: TestIssuer;
let revoked: ReturnType<typeof createRevokedList>;
let check: TokenCheck;
let now: number;
beforeEach(async () => {
  issuer = await startIssuer();
  now = 1_000_000;
  revoked = createRevokedList(issuer.url, recordedLog().log, () => now);
  const deps = { issuer: issuer.url, audience: AUDIENCE, id: 'probe', origin: ORIGIN, revoked };
  check = createTokenCheck({ ...deps, keys: remoteKeys(issuer.url).keys });
});
afterEach(async () => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
  await issuer.close();
});

const statusOf = (access: Access, bearer: string) =>
  check(bearer, access).then(
    () => 200,
    (err: { status: number }) => err.status
  );
const statuses = (bearer: string) =>
  Promise.all((['optional', 'read', 'write', 'admin'] as const).map((a) => statusOf(a, bearer)));

// A token the issuer signed with no jti: no revoke can name it, so no list guards it.
const noJti = async () => {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer.url, aud: AUDIENCE, sub: 'usr_1', scope: 'probe:admin', iat };
  const jwt = await new SignJWT({ ...claims, exp: iat + 600 })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: issuer.keys.kid })
    .sign(issuer.keys.privateKey);
  return `Bearer aga_${jwt}`;
};

describe('a stale revoked list (D2)', () => {
  it('fresh: every access passes; stale: write and admin are 503, reads pass', async () => {
    const admin = await issuer.bearer({ scope: 'probe:admin' });
    await revoked.refresh();
    now += STALE_MS;
    expect(await statuses(admin)).toEqual([200, 200, 200, 200]);
    now += 1;
    expect(await statuses(admin)).toEqual([200, 200, 503, 503]);
    await expect(check(admin, 'write')).rejects.toMatchObject(STALE);
    await expect(check(admin, 'admin')).rejects.toMatchObject(STALE);
    await revoked.refresh();
    expect(await statuses(admin)).toEqual([200, 200, 200, 200]);
  });

  it('stale: a revoked jti is 401 at every access; a missing scope is 403 before the 503', async () => {
    const admin = await issuer.bearer({ scope: 'probe:admin' });
    await issuer.revoke(String(claimsOf(admin)['jti']));
    await revoked.refresh();
    now += STALE_MS + 1;
    expect(await statuses(admin)).toEqual([401, 401, 401, 401]);
    const read = await issuer.bearer({ scope: 'probe:read' });
    expect(await statuses(read)).toEqual([200, 200, 403, 403]);
  });

  it('stale: a token with no jti is not affected; never read: 503 at every access', async () => {
    const admin = await issuer.bearer({ scope: 'probe:admin' });
    const unread = await statuses(admin);
    expect(unread).toEqual([503, 503, 503, 503]);
    await revoked.refresh();
    now += STALE_MS + 1;
    expect(await statuses(await noJti())).toEqual([200, 200, 200, 200]);
  });
});

describe('a stale revoked list on a part', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await partPackage();
  });

  it('an issuer gone over 5 minutes: a write is 503 with Retry-After, a read is 200', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const real = Date.now.bind(Date);
    let shift = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => real() + shift);
    const url = await startPart(dir, 'api', authEnv(issuer, dir));
    const authorization = await issuer.bearer({ scope: 'probe:write' });
    const write = () =>
      fetch(`${url}/api/probe/items`, { method: 'POST', headers: { authorization } });
    expect((await write()).status).toBe(200);
    await issuer.close();
    shift = STALE_MS + 1;
    const refused = await write();
    expect([refused.status, refused.headers.get('retry-after')]).toEqual([503, '5']);
    expect(await refused.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
    const read = await fetch(`${url}/api/probe/echo`, { headers: { authorization } });
    expect(read.status).toBe(200);
  });
});
