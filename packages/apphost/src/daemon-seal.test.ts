import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from './test-support/daemon-harness.js';
import { allPartsPackage } from '../../extension/src/test-support/hosted-fixture.js';
import { json, tempPackage } from '../../extension/src/test-support/packages.js';
import { forkLaunch } from './child.js';
import { permissionFlag, sealOf } from './seal.js';
import { BUILT_MAIN as MAIN } from '../../extension/src/test-support/launch-spec.js';

const SEALED = sealOf(process.versions.node) === 'on';

// GET /read?path=: the error code of a plain node:fs read (OK when it reads), never the bytes.
const SPY = `export const create = () => (req, res) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = new URL(req.url, 'http://x').searchParams.get('path') ?? '';
  try {
    fs.statSync(path).isDirectory() ? fs.readdirSync(path) : fs.readFileSync(path);
    res.json({ success: true, data: { code: 'OK' } });
  } catch (err) {
    res.json({ success: true, data: { code: err.code ?? 'ERROR' } });
  }
};
`;
const SPY_MANIFEST = {
  name: '@agentage/extension-spy',
  version: '0.1.0',
  type: 'module',
  engines: { agentage: '^0.20' },
  agentage: { id: 'spy', parts: { api: true } },
};

let h: Harness;
const spyPackage = () =>
  tempPackage({ 'package.json': json(SPY_MANIFEST), 'dist/api/index.js': SPY });
const read = async (path: string) => {
  const res = await h.call('GET', `/api/spy/read?path=${encodeURIComponent(path)}`);
  return (res.body as { data: { code: string } }).data.code;
};

describe.runIf(SEALED)('a sealed child (C2, Node at the floor)', () => {
  beforeAll(async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    h = await startHarness({ launch: forkLaunch(MAIN, undefined, 60) });
    const spy = await spyPackage();
    await writeFile(join(h.configDir, 'secrets.json'), json({ all: { 'tick-key': 'k' } }), {
      mode: 0o600,
    });
    await mkdir(join(h.configDir, 'data', 'other'), { recursive: true });
    await writeFile(join(h.configDir, 'data', 'other', 'x.txt'), 'x');
    await h.call('POST', '/host/extensions', { source: spy });
    await h.call('POST', '/host/extensions', { source: await allPartsPackage() });
  }, 60_000);
  afterAll(async () => {
    await h.daemon.stop();
    vi.restoreAllMocks();
  });

  it('is denied secrets.json, daemon.json, installation.json, data/other, run/other; reads its own data', async () => {
    const config = h.configDir;
    for (const file of ['secrets.json', 'daemon.json', 'installation.json'])
      expect([file, await read(join(config, file))]).toEqual([file, 'ERR_ACCESS_DENIED']);
    expect(await read(join(config, 'data', 'other'))).toBe('ERR_ACCESS_DENIED');
    expect(await read(join(config, 'data', 'other', 'x.txt'))).toBe('ERR_ACCESS_DENIED');
    expect(await read(join(config, 'run', 'all'))).toBe('ERR_ACCESS_DENIED');
    expect(await read(join(config, 'data', 'spy'))).toBe('OK');
  });

  it('api, mcp and worker with the store all run under the seal; /health says seal on', async () => {
    const health = (await h.call('GET', '/health')).body;
    expect(health).toMatchObject({ status: 'ok', extensions: [{}, { id: 'all', seal: 'on' }] });
    const MCP = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const listed = await fetch(`http://127.0.0.1:${h.daemon.port}/mcp/all`, {
      method: 'POST',
      headers: MCP,
      body,
    });
    expect(await listed.text()).toContain('all__echo');
    await vi.waitFor(
      async () => {
        const ticks = (await h.call('GET', '/api/all/ticks')).body as { data: { total: number } };
        expect(ticks.data.total).toBeGreaterThanOrEqual(2);
      },
      { timeout: 15_000, interval: 250 }
    );
  }, 30_000);
});

// Node 24.6.0 has --permission but not the D2 fixes: the flags still limit, /health says seal off.
describe.runIf(permissionFlag(process.versions.node))('a child below the floor (C2)', () => {
  beforeAll(async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    h = await startHarness({ launch: forkLaunch(MAIN, undefined, undefined, '24.6.0') });
    await h.call('POST', '/host/extensions', { source: await spyPackage() });
  }, 60_000);
  afterAll(async () => {
    await h.daemon.stop();
    vi.restoreAllMocks();
  });

  it('runs with the flags (secrets.json denied) and /health says seal off, degraded', async () => {
    expect(await read(join(h.configDir, 'secrets.json'))).toBe('ERR_ACCESS_DENIED');
    expect(await read(join(h.configDir, 'data', 'spy'))).toBe('OK');
    expect((await h.call('GET', '/health')).body).toMatchObject({
      status: 'degraded',
      seal: 'off',
      sealError: 'seal off: Node 22.22.2 or 24.14.1 needed, this is Node 24.6.0',
      extensions: [{ id: 'spy', state: 'running', seal: 'off' }],
    });
  });
});
