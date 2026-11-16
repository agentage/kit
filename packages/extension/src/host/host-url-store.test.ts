import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closedPort, fakeClickhouse } from '../test-support/fake-clickhouse.js';
import { HOSTED_MANIFEST, hostedPackage } from '../test-support/hosted-fixture.js';
import { recordedLog } from '../test-support/http.js';
import { json, tempPackage } from '../test-support/packages.js';
import { type PoolStore } from '../store/store.js';
import { hostExtension, type HostedExtension } from './host-extension.js';
import { hostStoreChecks, openUrlStore, postgresStore } from './host-url-store.js';

const SECRET = 'pw-never-logged';
const secrets = { 'api-token': 'tok' };
const hosted: HostedExtension[] = [];
afterEach(async () => {
  await Promise.all(hosted.splice(0).map((h) => h.stop()));
  vi.restoreAllMocks();
});

const urlFile = async (url: string) => `${await tempPackage({ 'store-url': url })}/store-url`;

describe('postgresStore', () => {
  it('serves queries on the part pool, never migrates, closes the pool on stop', async () => {
    const queries: string[] = [];
    let ended = 0;
    const pool = (): PoolStore => ({
      query: async (text) => (queries.push(text), { rows: [] }),
      end: async () => void (ended += 1),
    });
    const store = postgresStore('postgres://x', await hostedPackage(), recordedLog().log, pool);
    await store.query('select 1');
    expect(queries).toEqual(['select 1']);
    expect(Object.keys(store.checks ?? {})).toEqual(['store:migrations']);
    await store.close();
    expect([store.kind, ended]).toEqual(['postgres', 1]);
  });
});

describe('hostStoreChecks', () => {
  it('no store, no checks; a PGlite store keeps the one name', () => {
    expect(hostStoreChecks(undefined)).toEqual({});
    const pglite = { query: async () => ({ rows: [] }), close: async () => undefined };
    expect(Object.keys(hostStoreChecks(pglite))).toEqual(['store']);
  });

  it('store and store:<kind> share one probe; the store adds its own checks', async () => {
    let probes = 0;
    const store = {
      kind: 'postgres' as const,
      query: async () => (probes++, { rows: [] }),
      close: async () => undefined,
      checks: { 'store:migrations': async () => 'ok' as const },
    };
    const checks = hostStoreChecks(store);
    expect(Object.keys(checks)).toEqual(['store', 'store:postgres', 'store:migrations']);
    await Promise.all([checks['store']?.(), checks['store:postgres']?.()]);
    expect(probes).toBe(1);
  });
});

describe('openUrlStore', () => {
  it('unset gives undefined; a package with no postgres or clickhouse store warns and skips', async () => {
    const { log, lines } = recordedLog();
    const pkg = { ...HOSTED_MANIFEST, agentage: { ...HOSTED_MANIFEST.agentage, parts: {} } };
    const at = { dir: '/x', openMs: 100 };
    expect(await openUrlStore(HOSTED_MANIFEST as never, at, log)).toBeUndefined();
    expect(await openUrlStore(pkg as never, { ...at, file: '/x' }, log)).toBeUndefined();
    expect(lines).toMatchObject([{ level: 'warn', msg: expect.stringMatching(/unused$/) }]);
  });

  it('a postgres store that is down starts anyway, warns with no URL, and /health is 503', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const url = `postgres://u:${SECRET}@127.0.0.1:${await closedPort()}/db`;
    const opts = { dataDir: '', secrets, storeUrlFile: await urlFile(url), storeOpenMs: 2_000 };
    const host = await hostExtension(await hostedPackage(), opts);
    hosted.push(host);
    const body = await host.health();
    expect(body.data.checks).toEqual({
      store: 'unavailable',
      'store:postgres': 'unavailable',
      'store:migrations': 'unavailable',
    });
    const written = vi.mocked(process.stderr.write).mock.calls.join('\n');
    expect(written).toMatch(/the store did not open/);
    expect(written).not.toContain(SECRET);
  });

  it('a wrong URL in the file stops the start, never falls back to PGlite', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const file = await urlFile(`http://u:${SECRET}@h:8123/db`);
    const opts = { dataDir: '', secrets, storeUrlFile: file };
    const start = hostExtension(await hostedPackage(), opts);
    await expect(start).rejects.toThrow(/holds no postgres:\/\/ URL/);
    await expect(hostExtension(await hostedPackage(), opts)).rejects.not.toThrow(SECRET);
  });

  it('a clickhouse package gets the store as ctx.store; /health checks it', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ch = await fakeClickhouse(() => ({ body: '{"1":1}\n' }));
    const dir = await clickhousePackage();
    const opts = { dataDir: '', secrets, storeUrlFile: await urlFile(ch.url) };
    const host = await hostExtension(dir, opts);
    hosted.push(host);
    expect((await host.health()).data.checks).toEqual({ store: 'ok', 'store:clickhouse': 'ok' });
    expect(ch.seen.every((s) => s.user === 'logs' && s.body === 'select 1')).toBe(true);
  });
});

// The hosted fixture as a clickhouse package with no migrations.
const clickhousePackage = async () => {
  const dir = await hostedPackage();
  const parts = { api: true, store: 'clickhouse' };
  const manifest = { ...HOSTED_MANIFEST, agentage: { ...HOSTED_MANIFEST.agentage, parts } };
  await writeFile(join(dir, 'package.json'), json(manifest));
  await mkdir(join(dir, 'migrations'), { recursive: true });
  return dir;
};
