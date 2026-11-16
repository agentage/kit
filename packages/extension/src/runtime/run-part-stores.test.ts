import { writeFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Router } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Store } from '../store/store.types.js';
import { fakeClickhouse } from '../test-support/fake-clickhouse.js';
import { API_MANIFEST, json, tempDir, tempPackage } from '../test-support/packages.js';
import { runPart } from './run-part.js';

let server: Server | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(() => {
  server?.close();
  vi.restoreAllMocks();
});

const TOKEN_ENV = {
  PORT: '0',
  AGENTAGE_ORIGIN: 'https://probe.next.agentage.io',
  AGENTAGE_ISSUER: 'https://127.0.0.1:9',
  AGENTAGE_AUDIENCE: '*.agentage.io',
};

// The api part of a package with this store; returns the ctx.store its create got and /health checks.
const run = async (store: string, env: Record<string, string>) => {
  const parts = { api: true, store };
  const pkg = { ...API_MANIFEST, agentage: { ...API_MANIFEST.agentage, parts } };
  const dir = await tempPackage({ 'package.json': json(pkg) });
  let seen: Store | undefined;
  const importModule = async () => ({
    create: (ctx: { store?: Store }) => ((seen = ctx.store), Router()),
  });
  server = await runPart({
    dir,
    part: 'api',
    env: { ...TOKEN_ENV, ...env },
    importModule,
    serve: { signals: [] },
  });
  const port = (server.address() as AddressInfo).port;
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  return { store: seen, checks: (health as { data: { checks: unknown } }).data.checks };
};

describe('runPart stores', () => {
  it('opens a git store: gitRoot in AGENTAGE_DATA_DIR, the remote with no credential', async () => {
    const data = join(await tempDir(), 'store');
    const file = join(await tempDir(), 'store-url');
    await writeFile(file, 'http://root:s3cret@store-git:8080/root/\n');
    const env = { AGENTAGE_DATA_DIR: data, AGENTAGE_STORE_URL_FILE: file };
    const { store, checks } = await run('git', env);
    expect(store?.gitRoot).toBe(data);
    expect(store?.git?.remote).toBe('http://store-git:8080/root/');
    expect(JSON.stringify(store?.git)).not.toContain('s3cret');
    expect(checks).toMatchObject({ store: 'ok', 'store:git': 'ok' });
  });

  it('opens a git store with no remote when no file is set', async () => {
    const data = join(await tempDir(), 'store');
    const { store } = await run('git', { AGENTAGE_DATA_DIR: data });
    expect(store?.gitRoot).toBe(data);
    expect(store?.git?.remote).toBeUndefined();
  });

  it('opens a clickhouse store from AGENTAGE_STORE_URL_FILE', async () => {
    const ch = await fakeClickhouse(() => ({ body: '{"1":1}\n' }));
    const file = join(await tempDir(), 'store-url');
    await writeFile(file, `${ch.url}`);
    const { store, checks } = await run('clickhouse', { AGENTAGE_STORE_URL_FILE: file });
    expect(store?.query).toBeTypeOf('function');
    expect(checks).toMatchObject({ store: 'ok', 'store:clickhouse': 'ok' });
  });
});
