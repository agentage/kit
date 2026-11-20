import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Server } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudEnvOf, LOCAL_FLAG } from './cloud-env.js';
import { startCloudHost } from './cloud-host.js';
import { PROGRAM_VERSION } from './program-version.js';
import { createDaemon } from './daemon.js';
import { tempConfigDir } from './test-support/daemon-harness.js';
import {
  closeUpstreams,
  cloudEnv,
  quietLog,
  startCloud,
  type Started,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const SRC = dirname(fileURLToPath(import.meta.url));
const NO_ROWS = { extensions: [], upstreams: [] };

// Every host a server of this process was asked to listen on.
const listenHosts = () => {
  const spy = vi.spyOn(Server.prototype, 'listen');
  return () =>
    spy.mock.calls.map((args) => (typeof args[1] === 'string' ? args[1] : String(args[1])));
};

describe('the bind rule: 0.0.0.0 only through the cloud entry', () => {
  it('createDaemon binds 127.0.0.1 whatever env is set, the local flag too', async () => {
    for (const name of ['HOST', 'BIND', 'AGENTAGE_HOST', 'AGENTAGE_BIND', 'AGENTAGE_LISTEN'])
      vi.stubEnv(name, '0.0.0.0');
    vi.stubEnv(LOCAL_FLAG, '1');
    vi.stubEnv('AGENTAGE_URL', 'https://platform-host.next.agentage.io');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const hosts = listenHosts();
    const daemon = await createDaemon({
      configDir: await tempConfigDir(),
      port: 0,
      version: '0.0.0',
      startedBy: 'test',
    });
    await daemon.stop();
    expect(hosts()).toEqual(['127.0.0.1']);
  });

  it('the cloud entry listens on every interface', async () => {
    const hosts = listenHosts();
    host = await startCloud(await cloudEnv(NO_ROWS));
    expect(hosts()).toEqual(['0.0.0.0']);
  });

  it('the literal 0.0.0.0 is in the cloud entry only; it has its own bin', async () => {
    const files = (await readdir(SRC)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const texts = await Promise.all(files.map((f) => readFile(join(SRC, f), 'utf8')));
    expect(files.filter((_f, i) => texts[i]!.includes("'0.0.0.0'"))).toEqual(['cloud-host.ts']);
    const pkg = JSON.parse(await readFile(join(SRC, '../package.json'), 'utf8')) as {
      bin: unknown;
    };
    expect(pkg.bin).toEqual({ 'agentage-apphost-cloud': 'dist/cloud-main.js' });
    for (const file of ['index.ts', 'daemon.ts'])
      expect(await readFile(join(SRC, file), 'utf8')).not.toMatch(/from '\.\/cloud-/);
  });
});

describe('start checks of the cloud entry', () => {
  const env = { AGENTAGE_URL: 'https://a.b.io', AGENTAGE_CORE_URL: 'https://core.b.io' };
  it.each([
    ['AGENTAGE_URL', undefined],
    ['AGENTAGE_URL', 'http://a.b.io'],
    ['AGENTAGE_URL', 'https://a.b.io/path'],
    ['AGENTAGE_URL', 'https://u:p@a.b.io'],
    ['AGENTAGE_CORE_URL', 'http://core.b.io'],
    ['AGENTAGE_CORE_URL', 'core.b.io'],
  ])('%s=%s refuses the start', (name, value) => {
    expect(() => cloudEnvOf({ ...env, [name]: value })).toThrow(`${name}: not an https origin`);
  });

  it.each(['https://localhost', 'https://localhost:4290', 'https://site', 'https://[::1]'])(
    'AGENTAGE_URL=%s (no <host>.<domain>) refuses the start, with the local flag too',
    (value) => {
      const message = 'AGENTAGE_URL: not an https://<host>.<domain> origin';
      expect(() => cloudEnvOf({ ...env, AGENTAGE_URL: value })).toThrow(message);
      expect(() => cloudEnvOf({ ...env, AGENTAGE_URL: value, [LOCAL_FLAG]: '1' })).toThrow(message);
    }
  );

  it('own is the origin of AGENTAGE_URL (a trailing slash is dropped); a bad PORT refuses', () => {
    expect(cloudEnvOf({ ...env, AGENTAGE_URL: 'https://a.b.io/' }).own).toBe('https://a.b.io');
    expect(() => cloudEnvOf({ ...env, PORT: 'x' })).toThrow('PORT "x"');
  });

  it.each([
    ['AGENTAGE_URL', 'http://site.localhost'],
    ['AGENTAGE_URL', 'http://localhost:4290'],
    ['AGENTAGE_CORE_URL', 'http://127.0.0.1:9'],
  ])('%s=%s: refused by default, taken with the local flag', (name, value) => {
    expect(() => cloudEnvOf({ ...env, [name]: value })).toThrow(name);
    expect(cloudEnvOf({ ...env, [name]: value, [LOCAL_FLAG]: '1' }).local).toBe(true);
  });

  it('the local flag never takes http on a name that is not loopback, or a value but 1', () => {
    const local = { ...env, [LOCAL_FLAG]: '1', AGENTAGE_URL: 'http://a.b.io' };
    expect(() => cloudEnvOf(local)).toThrow('AGENTAGE_URL');
    expect(() => cloudEnvOf({ ...local, [LOCAL_FLAG]: 'true' })).toThrow('AGENTAGE_URL');
    expect(LOCAL_FLAG).toBe('STUB_LOOPBACK_HTTP');
  });

  it('the issuer only as an https origin, else no sign-in; the dev issuer only with the local flag', () => {
    const dev = { ...env, AGENTAGE_ISSUER: 'http://issuer:3000' };
    expect(cloudEnvOf(dev).issuer).toBeNull();
    expect(cloudEnvOf({ ...dev, [LOCAL_FLAG]: '1' }).issuer).toBe('http://issuer:3000');
    expect(cloudEnvOf({ ...env, AGENTAGE_ISSUER: 'https://auth.b.io' }).issuer).toBe(
      'https://auth.b.io'
    );
    expect(cloudEnvOf({ ...env, AGENTAGE_ISSUER: 'http://auth.b.io' }).issuer).toBeNull();
    const local = { ...env, [LOCAL_FLAG]: '1' };
    // One-label names: the compose services of the local stack (the dev issuer is `issuer`).
    const near = ['http://issuer:3000', 'http://127.0.0.1:4291', 'http://issuer.localhost:3000'];
    for (const one of [...near, 'http://localhost:3000'])
      expect(cloudEnvOf({ ...local, AGENTAGE_ISSUER: one }).issuer).toBe(one);
    for (const far of ['http://auth.b.io', 'http://10.0.0.1:3000'])
      expect(cloudEnvOf({ ...local, AGENTAGE_ISSUER: far }).issuer).toBeNull();
    expect(cloudEnvOf({ ...env, AGENTAGE_ISSUER: 'https://auth.b.io/x' }).issuer).toBeNull();
  });

  it('installation.json without upstreams.json refuses the start', async () => {
    const e = await cloudEnv(NO_ROWS);
    await rm(e.AGENTAGE_UPSTREAMS_FILE);
    await expect(startCloudHost(e, { log: quietLog() })).rejects.toThrow(
      'absent beside installation.json'
    );
  });

  it.each([
    ['AGENTAGE_UPSTREAMS_FILE', '{"id":"echo"}', 'expected array'],
    ['AGENTAGE_INSTALLATION_FILE', 'not json', 'is not valid JSON'],
    ['AGENTAGE_INSTALLATION_FILE', '{"host":"platform","extensions":[{"id":"echo"}]}', 'version'],
    [
      'AGENTAGE_INSTALLATION_FILE',
      '{"host":"p","extensions":[{"id":"e","version":"1.0.0","expose":{"app":"internal"}}]}',
      'expose',
    ],
  ])('a bad %s refuses the start, the file named', async (name, text, words) => {
    const e = await cloudEnv(NO_ROWS);
    await writeFile(e[name as keyof typeof e], text);
    const refused = startCloudHost(e, { log: quietLog() });
    await expect(refused).rejects.toThrow(words);
  });

  it('no installation.json: no rows, the host named by the first label of AGENTAGE_URL', async () => {
    const e = await cloudEnv(NO_ROWS);
    await rm(e.AGENTAGE_INSTALLATION_FILE);
    host = await startCloud(e);
    const doc = JSON.parse((await host.call('/.well-known/agentage-host.json')).body) as unknown;
    expect(doc).toEqual({ host: 'platform-host', kind: 'cloud', extensions: [] });
  });
});

describe('the Host allow-list and /health', () => {
  it('a Host that is not the name of AGENTAGE_URL is 400; /health answers any Host (the probe)', async () => {
    host = await startCloud(await cloudEnv(NO_ROWS));
    const res = await host.call('/.well-known/agentage-host.json', {
      headers: { host: 'evil.example' },
    });
    expect([res.status, JSON.parse(res.body).error.code]).toEqual([400, 'UNKNOWN_HOST']);
    expect((await host.call('/health', { headers: { host: '127.0.0.1:3000' } })).status).toBe(200);
    const local = { headers: { host: 'localhost:4290' } };
    expect((await host.call('/.well-known/agentage-host.json', local)).status).toBe(400);
  });

  it('with the local flag the local router address is a name of this host too', async () => {
    host = await startCloud(await cloudEnv(NO_ROWS, { [LOCAL_FLAG]: '1' }));
    const local = { headers: { host: 'localhost:4290' } };
    expect((await host.call('/.well-known/agentage-host.json', local)).status).toBe(200);
    const evil = { headers: { host: 'evil.example' } };
    expect((await host.call('/.well-known/agentage-host.json', evil)).status).toBe(400);
  });

  it('/health: the stub router shape, every key estate verify reads, no-store', async () => {
    const build = { COMMIT_SHA: 'abcdef1', BUILD_TIME: '2026-11-19T00:00:00Z' };
    host = await startCloud(await cloudEnv(NO_ROWS, build));
    const res = await host.call('/health');
    const body = JSON.parse(res.body) as { success: boolean; data: Record<string, unknown> };
    expect([res.status, res.headers['cache-control'], body.success]).toEqual([
      200,
      'no-store',
      true,
    ]);
    expect(body.data).toMatchObject({
      status: 'ok',
      extension: 'site',
      part: 'router',
      version: PROGRAM_VERSION,
      commit: 'abcdef1',
      buildTime: '2026-11-19T00:00:00Z',
      checks: {},
    });
    expect(Object.keys(body.data)).toEqual(
      expect.arrayContaining(['buildTime', 'instance', 'uptimeSeconds', 'checkedAt', 'checks'])
    );
    expect(body.data['instance']).toMatch(/^[0-9a-f]{8}$/);
  });
});
