import { writeFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { createServer, type Server as NetServer } from 'node:net';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Router } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type McpContext } from '../mcp/tools.js';
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

// The api part of a package with this store: the ctx.store its create got, /health, the start in ms.
const run = async (
  store: string,
  env: Record<string, string>,
  files: Record<string, string> = {}
) => {
  const parts = { api: true, store };
  const pkg = { ...API_MANIFEST, agentage: { ...API_MANIFEST.agentage, parts } };
  const dir = await tempPackage({ 'package.json': json(pkg), ...files });
  let seen: Store | undefined;
  const importModule = async () => ({
    create: (ctx: { store?: Store }) => ((seen = ctx.store), Router()),
  });
  const started = Date.now();
  const options = { dir, part: 'api', env: { ...TOKEN_ENV, ...env }, importModule };
  server = await runPart({ ...options, serve: { signals: [] } });
  const ms = Date.now() - started;
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const health = (await res.json()) as { data: { checks: Record<string, string> } };
  return { store: seen, checks: health.data.checks, status: res.status, ms };
};

// A store that takes the connection and never answers.
const silentPort = async () => {
  const server = createServer(() => undefined);
  silent.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return (server.address() as AddressInfo).port;
};
const silent: NetServer[] = [];
afterEach(() => silent.splice(0).forEach((s) => s.close()));

const urlFile = async (url: string) => {
  const file = join(await tempDir(), 'store-url');
  await writeFile(file, url);
  return file;
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

describe('runPart store open', () => {
  it('listens before the store answers: /health is 503 meanwhile, no 120 s wait', async () => {
    const ch = await fakeClickhouse(() => ({ body: '{"1":1}\n', wait: 3_000 }));
    const env = { AGENTAGE_STORE_URL_FILE: await urlFile(ch.url) };
    const { status, ms, checks } = await run('clickhouse', env);
    expect(ms).toBeLessThan(1_500);
    expect([status, checks['store:clickhouse']]).toEqual([503, 'unavailable']);
  });

  it('a postgres part with a URL file starts at once and adds store:migrations', async () => {
    const env = {
      AGENTAGE_STORE_URL_FILE: await urlFile(`postgres://p:x@127.0.0.1:${await silentPort()}/p`),
    };
    const migrations = { 'migrations/001-a.sql': 'create table a (n int);\n' };
    const { status, ms, checks } = await run('postgres', env, migrations);
    expect(ms).toBeLessThan(1_500);
    expect(status).toBe(503);
    expect(Object.keys(checks)).toEqual(
      expect.arrayContaining(['store', 'store:postgres', 'store:migrations'])
    );
  });

  it('refuses a missing URL file and a URL of the wrong kind, never printing the URL', async () => {
    const missing = { AGENTAGE_STORE_URL_FILE: join(await tempDir(), 'none') };
    await expect(run('postgres', missing)).rejects.toThrow(
      /AGENTAGE_STORE_URL_FILE .*cannot read it/
    );
    const wrong = { AGENTAGE_STORE_URL_FILE: await urlFile('http://u:s3cret@h:8123/db') };
    await expect(run('postgres', wrong)).rejects.toThrow(
      'holds no postgres:// URL for the postgres store'
    );
  });
});

describe('runPart mcp paths', () => {
  it('serves /mcp and /mcp/{id}, /connector/{id} and their RFC 9728 documents', async () => {
    const parts = { mcp: true };
    const pkg = { ...API_MANIFEST, agentage: { ...API_MANIFEST.agentage, parts } };
    const dir = await tempPackage({ 'package.json': json(pkg) });
    const importModule = async () => ({
      create: (ctx: McpContext) =>
        ctx.connector('fetch', { description: 'Fetch', input: z.object({}) }, () => ({})),
    });
    server = await runPart({
      dir,
      part: 'mcp',
      env: TOKEN_ENV,
      importModule,
      serve: { signals: [] },
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const status = async (path: string) =>
      (await fetch(`${base}${path}`, { method: 'POST' })).status;
    for (const path of ['/mcp', '/mcp/probe', '/connector', '/connector/probe'])
      expect(await status(path), path).not.toBe(404);
    expect(await status('/mcp/other')).toBe(404);
    for (const path of ['/mcp/probe', '/connector/probe']) {
      const prm = await fetch(`${base}/.well-known/oauth-protected-resource${path}`);
      expect(await prm.json()).toMatchObject({
        resource: `https://probe.next.agentage.io${path}`,
        authorization_servers: ['https://127.0.0.1:9'],
      });
    }
  });
});
