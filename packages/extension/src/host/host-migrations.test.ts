import { describe, expect, it } from 'vitest';
import { hostedPackage } from '../test-support/hosted-fixture.js';
import { recordedLog } from '../test-support/http.js';
import { json, tempPackage } from '../test-support/packages.js';
import { migrate } from '../store/migrations.js';
import { createTestStore } from '../store/test-store.js';
import { migrateHost, migrationsCheck, pendingMigrations } from './host-migrations.js';

const SECRET = 'pw-never-printed';

describe('pendingMigrations and migrationsCheck', () => {
  it('names every migration on a store with no ledger, none once the migrate job ran', async () => {
    const dir = await hostedPackage();
    const store = createTestStore(async () => undefined);
    expect(await pendingMigrations(store, dir)).toEqual(['kit:001-job-runs', '001-hits.sql']);
    const { log, lines } = recordedLog();
    const check = migrationsCheck(store, dir, log);
    expect([await check(), await check()]).toEqual(['unavailable', 'unavailable']);
    expect(lines).toMatchObject([
      { level: 'warn', msg: 'migrations not applied: run the migrate job' },
    ]);
    await migrate(store, dir, recordedLog().log);
    expect(await pendingMigrations(store, dir)).toEqual([]);
    expect(await check()).toBe('ok');
    await store.close();
  });

  it('a store error other than a missing ledger passes through', async () => {
    const store = {
      query: async () => Promise.reject(Object.assign(new Error('x'), { code: '08006' })),
    };
    await expect(pendingMigrations(store, await hostedPackage())).rejects.toThrow('x');
  });
});

describe('migrateHost', () => {
  const pkgWith = async (parts: Record<string, unknown>) =>
    tempPackage({
      'package.json': json({
        name: 'x',
        version: '1.0.0',
        engines: { agentage: '^0.23' },
        agentage: { id: 'x', parts },
      }),
    });

  it('needs AGENTAGE_STORE_URL_FILE; a package with no postgres store has nothing to migrate', async () => {
    const dir = await hostedPackage();
    await expect(migrateHost({ AGENTAGE_EXTENSION_DIR: dir })).rejects.toThrow(
      'migrate needs AGENTAGE_STORE_URL_FILE'
    );
    const ch = await pkgWith({ api: true, store: 'clickhouse' });
    const env = { AGENTAGE_EXTENSION_DIR: ch, AGENTAGE_STORE_URL_FILE: '/nowhere' };
    expect(await migrateHost(env)).toBeUndefined();
  });

  it('a wrong URL stops the job, naming the file, never the value', async () => {
    const file = `${await tempPackage({ 'store-url': `http://u:${SECRET}@h/db` })}/store-url`;
    const env = { AGENTAGE_EXTENSION_DIR: await hostedPackage(), AGENTAGE_STORE_URL_FILE: file };
    const err = (await migrateHost(env).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/store-url: holds no postgres:\/\/ URL/);
    expect(err.message).not.toContain(SECRET);
  });
});
