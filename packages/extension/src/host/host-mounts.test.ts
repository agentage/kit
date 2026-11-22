import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startOn, type TestServer } from '../testing/test-server.js';
import { startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { mountsPackage } from '../test-support/mounts-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { hostExtension, type HostedExtension } from './host-extension.js';
import { serveHost, type ServedHost } from './serve-host.js';

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const ORIGIN = 'http://mem.next.agentage.io';
const REFS = '/files/mem/u_1/default.git/info/refs';
const hosted: HostedExtension[] = [];
const served: ServedHost[] = [];
let issuer: TestIssuer | undefined;

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await Promise.all(hosted.splice(0).map((h) => h.stop()));
  for (const s of served.splice(0)) (s.server.close(), await s.host.stop());
  await issuer?.close();
  vi.restoreAllMocks();
});

const rpc = (method: string, params?: object, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { ...MCP, ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});

const open = async (): Promise<TestServer> => {
  const h = await hostExtension(await mountsPackage(), { dataDir: await tempDir() });
  hosted.push(h);
  return startOn(h.app);
};

const checked = async () => {
  issuer = await startIssuer();
  const env = {
    PORT: '0',
    AGENTAGE_EXTENSION_DIR: await mountsPackage(),
    AGENTAGE_SECRETS_DIR: await tempDir(),
    AGENTAGE_HOST_BIND: 'all',
    AGENTAGE_ISSUER: issuer.url,
    AGENTAGE_AUDIENCE: '*.agentage.io',
    AGENTAGE_ORIGIN: ORIGIN,
  };
  const s = await serveHost(env, { exit: vi.fn(), ready: vi.fn(), signals: [] });
  served.push(s);
  const { port } = s.server.address() as { port: number };
  return (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
};

// git sends the token as the Basic password.
const basic = (bearer: string) =>
  `Basic ${Buffer.from(`x:${bearer.slice('Bearer '.length)}`).toString('base64')}`;

describe('extra mounts with no token check (a daemon child)', () => {
  it('/files/{id}/* reaches ctx.files anonymous, a 2 MB pack passes whole', async () => {
    const server = await open();
    const refs = await server.fetch(`${REFS}?service=git-upload-pack`);
    const path = '/u_1/default.git/info/refs';
    expect([refs.status, await refs.json()]).toEqual([200, { path, sub: null, bytes: 0 }]);
    const pack = Buffer.alloc(2 * 1024 * 1024, 7);
    const post = { method: 'POST', body: pack, headers: { 'content-type': 'x-git' } };
    const up = await server.fetch('/files/mem/u_1/default.git/git-upload-pack', post);
    expect(((await up.json()) as { bytes: number }).bytes).toBe(pack.length);
    await server.close();
  });

  it('/connector/{id} lists the connector tools by their own name, apart from /mcp/{id}', async () => {
    const server = await open();
    const connector = await (await server.fetch('/connector/mem', rpc('tools/list'))).text();
    expect(connector).toContain('"name":"search"');
    expect(connector).not.toContain('mem_echo');
    const mcp = await (await server.fetch('/mcp/mem', rpc('tools/list'))).text();
    expect([mcp.includes('"name":"mem_echo"'), mcp.includes('search')]).toEqual([true, false]);
    const call = rpc('tools/call', { name: 'search', arguments: { query: 'q' } });
    expect(await (await server.fetch('/connector/mem', call)).text()).toContain('nobody');
    const record = await (await server.fetch('/.well-known/agentage-extension.json')).text();
    expect(record).not.toContain('search');
    await server.close();
  });
});

describe('extra mounts with a token check', () => {
  it('git: 401 names Basic; a read token clones, a push needs write', async () => {
    const at = await checked();
    const none = await at(`${REFS}?service=git-upload-pack`);
    expect([none.status, none.headers.get('www-authenticate')]).toEqual([
      401,
      'Basic realm="agentage"',
    ]);
    const read = basic(await issuer!.bearer({ scope: 'mem:read', sub: 'u_1' }));
    const clone = await at(`${REFS}?service=git-upload-pack`, { headers: { authorization: read } });
    expect(await clone.json()).toMatchObject({ sub: 'u_1' });
    const push = { headers: { authorization: read } };
    expect((await at(`${REFS}?service=git-receive-pack`, push)).status).toBe(403);
    const write = basic(await issuer!.bearer({ scope: 'mem:write', sub: 'u_1' }));
    const pushed = await at(`${REFS}?service=git-receive-pack`, {
      headers: { authorization: write },
    });
    expect(pushed.status).toBe(200);
  });

  it('mcp and connector: a resource document per path, the 401 names it', async () => {
    const at = await checked();
    for (const path of ['/mcp/mem', '/connector/mem']) {
      const doc = await (await at(`/.well-known/oauth-protected-resource${path}`)).json();
      expect(doc).toMatchObject({
        resource: `${ORIGIN}${path}`,
        authorization_servers: [issuer!.url],
      });
    }
    const call = rpc('tools/call', { name: 'mem_echo', arguments: {} });
    const refused = await at('/mcp/mem', call);
    const metadata = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/mem"`;
    expect([refused.status, refused.headers.get('www-authenticate')]).toEqual([401, metadata]);
    const slash = await at('/mcp/mem/', call);
    expect([slash.status, slash.headers.get('www-authenticate')]).toEqual([401, metadata]);
    const bearer = await issuer!.bearer({ scope: 'mem:read', sub: 'u_2' });
    const search = rpc(
      'tools/call',
      { name: 'search', arguments: { query: 'q' } },
      { authorization: bearer }
    );
    expect(await (await at('/connector/mem', search)).text()).toContain('u_2');
  });
});
