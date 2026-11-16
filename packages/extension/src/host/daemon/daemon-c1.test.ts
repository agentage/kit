import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { allPartsPackage } from '../../test-support/hosted-fixture.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { json } from '../../test-support/packages.js';
import { type Launch } from './child.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const OPENAPI = { openapi: '3.1.0', info: { title: 'all', version: '1.0.0' }, paths: {} };
const PARTS = ['api', 'mcp', 'worker'];

// The all-parts package on the daemon, its worker secret set: running.
const allRunning = async (launch: Launch = inProcessLaunch) => {
  h = await startHarness({ launch });
  const dir = await allPartsPackage();
  await writeFile(join(dir, 'openapi.json'), json(OPENAPI));
  await h.call('POST', '/host/extensions', { source: dir });
  await h.call('PATCH', '/host/extensions/all', { secrets: { 'tick-key': 'k' } });
  return h;
};

const at = (path: string) => `http://127.0.0.1:${h!.daemon.port}${path}`;
const rpc = (method: string, params?: object) =>
  fetch(at('/mcp/all'), {
    method: 'POST',
    headers: MCP,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

describe('the daemon routes of C1', () => {
  it('/mcp/{id} reaches the child: tools/list, tools/call; GET is 405 from the child', async () => {
    await allRunning();
    expect(await (await rpc('tools/list')).text()).toContain('"name":"all__echo"');
    const call = await rpc('tools/call', { name: 'all__echo', arguments: { msg: 'hi' } });
    expect(await call.text()).toContain('pong hi');
    expect((await fetch(at('/mcp/all'))).status).toBe(405);
  });

  it('/mcp/{id}: 503 while the child is not running, 404 envelope not installed or disabled', async () => {
    h = await startHarness();
    await h.call('POST', '/host/extensions', { source: await allPartsPackage() });
    const down = await rpc('tools/list');
    expect([down.status, await down.json()]).toMatchObject([
      503,
      { error: { code: 'UNAVAILABLE' } },
    ]);
    const nope = await fetch(at('/mcp/nope'), { method: 'POST', headers: MCP, body: '{}' });
    expect([nope.status, await nope.json()]).toMatchObject([404, { error: { code: 'NOT_FOUND' } }]);
    await h.call('PATCH', '/host/extensions/all', { enabled: false });
    expect((await rpc('tools/list')).status).toBe(404);
  });

  it('/api/{id}/openapi.json is the child document; discovery names the parts', async () => {
    await allRunning();
    expect(await (await fetch(at('/api/all/openapi.json'))).json()).toEqual(OPENAPI);
    const doc = await fetch(at('/.well-known/agentage-host.json'));
    expect(await doc.json()).toEqual({
      host: 'local',
      extensions: [{ id: 'all', version: '1.0.0', parts: PARTS }],
    });
  });

  it('/health: each entry has parts, seal and restarts; a sealed launch is ok', async () => {
    await allRunning(
      Object.assign((spec: Parameters<Launch>[0]) => inProcessLaunch(spec), { seal: 'on' as const })
    );
    const { body } = await h!.call('GET', '/health');
    expect(body).toMatchObject({
      status: 'ok',
      extensions: [{ id: 'all', state: 'running', parts: PARTS, seal: 'on', restarts: 0 }],
    });
    expect(body).not.toHaveProperty('sealError');
  });

  it('/health below the Node floor: seal off, degraded, the reason; the child still serves', async () => {
    await allRunning(
      Object.assign((spec: Parameters<Launch>[0]) => inProcessLaunch(spec), {
        seal: 'off' as const,
      })
    );
    const { body } = await h!.call('GET', '/health');
    expect(body).toMatchObject({
      status: 'degraded',
      seal: 'off',
      sealError: expect.stringMatching(
        /^seal off: Node 22\.22\.2 or 24\.14\.1 needed, this is Node /
      ),
      extensions: [{ id: 'all', state: 'running', seal: 'off' }],
    });
    expect((await rpc('tools/list')).status).toBe(200);
  });
});

describe('the host token on /host/* (D11)', () => {
  const send = (path: string, method = 'GET', token?: string) =>
    fetch(at(path), { method, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('401 with no token, 403 with another, 200 with the one in daemon.json', async () => {
    h = await startHarness();
    for (const [method, path] of [
      ['GET', '/host/extensions'],
      ['POST', '/host/extensions'],
      ['PATCH', '/host/extensions/x'],
      ['DELETE', '/host/extensions/x'],
      ['POST', '/host/extensions/x/reload'],
    ] as const) {
      const none = await send(path, method);
      expect([path, none.status, await none.json()]).toMatchObject([
        path,
        401,
        { success: false, error: { code: 'UNAUTHORIZED' } },
      ]);
      const wrong = await send(path, method, `${h.token}x`);
      expect([path, wrong.status]).toEqual([path, 403]);
    }
    expect((await send('/host/extensions', 'GET', h.token)).status).toBe(200);
    expect((await send('/health')).status).toBe(200);
    expect((await send('/api/x/y', 'GET', h.token)).status).toBe(404);
    const written = vi.mocked(process.stderr.write).mock.calls.map(([chunk]) => String(chunk));
    expect(written.filter((line) => line.includes(h!.token))).toEqual([]);
  });
});
