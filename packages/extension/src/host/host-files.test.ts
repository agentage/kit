import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { MAX_PUSH, mountsPackage } from '../test-support/mounts-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { serveHost, type ServedHost } from './serve-host.js';

const REPO = '/files/mem/u_1/default.git';
const served: ServedHost[] = [];
let issuer: TestIssuer | undefined;
let port = 0;

beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  issuer = await startIssuer();
  const env = {
    PORT: '0',
    AGENTAGE_EXTENSION_DIR: await mountsPackage(),
    AGENTAGE_SECRETS_DIR: await tempDir(),
    AGENTAGE_HOST_BIND: 'all',
    AGENTAGE_ISSUER: issuer.url,
    AGENTAGE_AUDIENCE: '*.agentage.io',
    AGENTAGE_ORIGIN: 'http://mem.next.agentage.io',
  };
  const s = await serveHost(env, { exit: vi.fn(), ready: vi.fn(), signals: [] });
  served.push(s);
  port = (s.server.address() as { port: number }).port;
});
afterEach(async () => {
  for (const s of served.splice(0)) (s.server.close(), await s.host.stop());
  await issuer?.close();
  vi.restoreAllMocks();
});

const token = async (scope: string, sub = 'u_1') =>
  `Basic ${Buffer.from(`x:${(await issuer!.bearer({ scope, sub })).slice(7)}`).toString('base64')}`;

// node:http sends the path as written: fetch would resolve a dot segment first.
const raw = (method: string, path: string, authorization: string, body?: Buffer) =>
  new Promise<number>((resolve, reject) => {
    const headers = { authorization, ...(body && { 'content-type': 'x-git' }) };
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(body);
  });

describe('/files/{id}/* access is deny by default (KIT.3)', () => {
  it('a read token clones and fetches, nothing more', async () => {
    const read = await token('mem:read');
    expect(await raw('GET', `${REPO}/info/refs?service=git-upload-pack`, read)).toBe(200);
    expect(await raw('POST', `${REPO}/git-upload-pack`, read, Buffer.from('0000'))).toBe(200);
  });

  it.each([
    ['GET', '/info/refs?service=git-receive-pack'],
    ['GET', '/info/refs?service=git-receive-pack&service=git-receive-pack'],
    ['GET', '/info/refs?service=git-upload-pack&service=git-upload-pack'],
    ['GET', '/info/refs?service=git-upload-pack&service=git-receive-pack'],
    ['GET', '/info/refs?service[]=git-upload-pack'],
    ['GET', '/info/refs?service=git-upload-pack&%73ervice=git-receive-pack'],
    ['GET', '/info/refs?service=git-upload-pack?x'],
    ['GET', '/info/refs?service=git-upload-pack&x=1'],
    ['GET', '/info/refs?service=GIT-UPLOAD-PACK'],
    ['GET', '/info/refs?service=git%2Dupload-pack'],
    ['GET', '/info/refs/?service=git-upload-pack'],
    ['GET', '/info/refs'],
    ['GET', '/HEAD'],
    ['POST', '/git-receive-pack'],
    ['POST', '/git-upload-pack/'],
    ['POST', '/git%2Dupload-pack'],
    ['POST', '/GIT-UPLOAD-PACK'],
    ['PUT', '/git-upload-pack'],
  ])('a read token gets 403 on %s %s', async (method, rest) => {
    expect(await raw(method, `${REPO}${rest}`, await token('mem:read'))).toBe(403);
  });

  it('a token of another extension gets 403, even with write', async () => {
    const other = await token('other:write other:read');
    expect(await raw('GET', `${REPO}/info/refs?service=git-upload-pack`, other)).toBe(403);
  });

  it.each(['/u_1/../u_2/default.git', '/u_1/%2e%2e/u_2/default.git', '/u_1%2F..%2Fu_2/x.git'])(
    'a dot segment in %s is a 400',
    async (repo) => {
      const write = await token('mem:write');
      expect(await raw('GET', `/files/mem${repo}/info/refs?service=git-upload-pack`, write)).toBe(
        400
      );
    }
  );

  it('the owner hook runs on every request: user 1 cannot reach the path of user 2', async () => {
    const write = await token('mem:write', 'u_1');
    const other = '/files/mem/u_2/default.git';
    expect(await raw('GET', `${other}/info/refs?service=git-upload-pack`, write)).toBe(403);
    expect(await raw('POST', `${other}/git-receive-pack`, write, Buffer.from('0000'))).toBe(403);
  });

  it('a push over the byte cap is refused, by length or by the bytes sent', async () => {
    const write = await token('mem:write');
    const under = Buffer.alloc(MAX_PUSH, 1);
    expect(await raw('POST', `${REPO}/git-receive-pack`, write, under)).toBe(200);
    const over = Buffer.alloc(MAX_PUSH + 1, 1);
    expect(await raw('POST', `${REPO}/git-receive-pack`, write, over)).toBe(413);
    const chunked = await new Promise<number | string>((resolve) => {
      const headers = { authorization: write, 'transfer-encoding': 'chunked' };
      const path = `${REPO}/git-receive-pack`;
      const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', () => resolve('reset'));
      for (let i = 0; i < 5; i++) req.write(Buffer.alloc(MAX_PUSH / 2, 1));
      req.end();
    });
    expect([413, 'reset']).toContain(chunked);
  });
});
