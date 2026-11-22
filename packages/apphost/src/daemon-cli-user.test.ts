import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, tempConfigDir, type Harness } from './test-support/daemon-harness.js';
import { fakeIssuer, signedInAuth } from '../../extension/src/test-support/fake-issuer.js';
import { inProcessLaunch } from './test-support/in-process-launch.js';
import { linkModules } from '../../extension/src/test-support/http.js';
import { mountsPackage, MOUNTS_MANIFEST } from '../../extension/src/test-support/mounts-fixture.js';
import { json, tempPackage } from '../../extension/src/test-support/packages.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
let auth: Awaited<ReturnType<typeof fakeIssuer>>;
beforeAll(async () => (auth = await fakeIssuer({ 'opaque-alice': 'u_alice' })));
afterAll(() => auth.close());

// An api part that returns a router (no openapi.json) and an mcp tool, each naming its caller.
const whoPackage = async () => {
  const manifest = {
    ...MOUNTS_MANIFEST,
    name: '@agentage/extension-who',
    agentage: { id: 'who', parts: { api: true, mcp: true } },
  };
  const dir = await tempPackage({
    'package.json': json(manifest),
    'dist/api/index.js': `export const create = (ctx) => (req, res) =>
  res.json({ success: true, data: ctx.auth.caller(req)?.sub ?? null });\n`,
    'dist/mcp/index.js': `import { z } from 'zod';
export const create = (ctx) => ctx.tool('who', { description: 'Who', input: z.object({}),
  output: z.object({ sub: z.string().nullable() }) }, (_args, caller) => ({ sub: caller?.sub ?? null }));\n`,
  });
  await linkModules(dir);
  return dir;
};

const started = async (text?: string) => {
  const configDir = await tempConfigDir();
  if (text) await writeFile(join(configDir, 'auth.json'), text);
  h = await startHarness({ configDir, launch: inProcessLaunch, userPollMs: 50 });
  await h.call('POST', '/host/extensions', { source: await mountsPackage() });
  await h.call('POST', '/host/extensions', { source: await whoPackage() });
  const at = (path: string) => `http://127.0.0.1:${h!.daemon.port}${path}`;
  const refs = async (user: string) => {
    const res = await fetch(at(`/files/mem/${user}/default.git/info/refs?service=git-upload-pack`));
    return [res.status, res.status === 200 ? ((await res.json()) as { sub: unknown }).sub : null];
  };
  const search = async () => {
    const params = { name: 'search', arguments: { query: 'q' } };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
    const text = await (
      await fetch(at('/connector/mem'), { method: 'POST', headers: MCP, body })
    ).text();
    return text.includes('"ids":["q","u_alice"]')
      ? 'u_alice'
      : text.includes('"nobody"')
        ? 'nobody'
        : text;
  };
  const api = async () =>
    ((await (await fetch(at('/api/who/me'))).json()) as { data: unknown }).data;
  const tool = async () => {
    const params = { name: 'who_who', arguments: {} };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params });
    const text = await (await fetch(at('/mcp/who'), { method: 'POST', headers: MCP, body })).text();
    const line = text.split('\n').find((l) => l.startsWith('data:')) ?? `data:${text}`;
    return (JSON.parse(line.slice(5)) as { result: { structuredContent: { sub: unknown } } }).result
      .structuredContent.sub;
  };
  // The kit's caller route, passed through as any /api/{id}/* path.
  const caller = async () => {
    const res = await fetch(at('/api/who/caller'));
    return [
      res.status,
      res.headers.get('cache-control'),
      res.status === 200 ? await res.json() : null,
    ];
  };
  return { refs, search, api, tool, caller, configDir };
};

describe('the daemon passes the signed-in cli user to its children', () => {
  it('right after agentage setup (auth.json as signIn writes it): every request acts as that user', async () => {
    const { refs, search, api, tool, caller } = await started(
      signedInAuth(auth.issuer, 'opaque-alice')
    );
    expect([await api(), await tool()]).toEqual(['u_alice', 'u_alice']);
    expect(await refs('u_alice')).toEqual([200, 'u_alice']);
    expect((await refs('local'))[0]).toBe(403);
    expect(await search()).toBe('u_alice');
    expect(await caller()).toEqual([
      200,
      'no-store',
      { success: true, data: { sub: 'u_alice', scopes: ['who:read', 'who:write'] } },
    ]);
  });

  it('signed out (no auth.json, or one that names no user): no caller, as before', async () => {
    const noIssuer = JSON.stringify({
      siteFqdn: 'agentage.io',
      tokens: { accessToken: 'opaque-alice' },
    });
    for (const text of [undefined, noIssuer]) {
      const { refs, search, api, tool, caller } = await started(text);
      expect([await api(), await tool()]).toEqual([null, null]);
      // No check, no kit route: the path falls to the extension's own router.
      expect(await caller()).toEqual([200, null, { success: true, data: null }]);
      expect(await refs('local')).toEqual([200, null]);
      expect(await search()).toBe('nobody');
      await h?.daemon.stop();
      h = undefined;
    }
  });

  it('a sign-out and a sign-in reach the running children (they restart)', async () => {
    const { api, tool, configDir } = await started(signedInAuth(auth.issuer, 'opaque-alice'));
    expect(await api()).toBe('u_alice');
    await rm(join(configDir, 'auth.json'));
    await vi.waitFor(async () => expect([await api(), await tool()]).toEqual([null, null]), {
      timeout: 10_000,
    });
    await writeFile(join(configDir, 'auth.json'), signedInAuth(auth.issuer, 'opaque-alice'));
    await vi.waitFor(async () => expect(await api()).toBe('u_alice'), { timeout: 10_000 });
  });
});
