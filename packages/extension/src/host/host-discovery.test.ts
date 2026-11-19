import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryDocumentSchema } from '../discovery/discovery.schema.js';
import { startOn, type TestServer } from '../testing/test-server.js';
import {
  allPartsPackage,
  hostedPackage,
  NO_STORE_MANIFEST,
} from '../test-support/hosted-fixture.js';
import { json, tempDir } from '../test-support/packages.js';
import { hostExtension, type HostedExtension } from './host-extension.js';

const OPENAPI = { openapi: '3.1.0', info: { title: 'all', version: '1.0.0' }, paths: {} };
const hosted: HostedExtension[] = [];
const servers: TestServer[] = [];

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(hosted.splice(0).map((h) => h.stop()));
  vi.restoreAllMocks();
});

const discoveryOf = async (dir: string, secrets: Record<string, string>) => {
  const dataDir = join(await tempDir('agentage-host-discovery-'), 'data');
  const h = await hostExtension(dir, { dataDir, secrets });
  hosted.push(h);
  const server = await startOn(h.app);
  servers.push(server);
  const doc = (await (await server.fetch('/.well-known/agentage-extension.json')).json()) as object;
  return { doc, host: server.url };
};

describe('the kit host serves the full discovery record', () => {
  it('every server part with no image, the openapi, the tools and the migration count', async () => {
    const dir = await allPartsPackage();
    await writeFile(join(dir, 'openapi.json'), json(OPENAPI));
    const { doc, host } = await discoveryOf(dir, { 'tick-key': 'k' });
    expect(doc).toMatchObject({
      id: 'all',
      host,
      parts: { api: {}, mcp: {}, worker: {}, store: { kind: 'postgres', migrations: 1 } },
      openapi: '/api/all/openapi.json',
      tools: [{ name: 'all__echo', scope: 'all:read' }],
      serves: ['api', 'mcp', 'worker'],
    });
    expect(doc).not.toHaveProperty('app');
    expect(doc).not.toHaveProperty('secretParts');
    expect(DiscoveryDocumentSchema.safeParse(doc).error?.issues).toBeUndefined();
  });

  it('an api package with a store: the api part and the store, no openapi when none is served', async () => {
    const { doc } = await discoveryOf(await hostedPackage(), { 'api-token': 'tok-123' });
    expect(doc).toMatchObject({ parts: { api: {}, store: { kind: 'postgres', migrations: 1 } } });
    expect(Object.keys((doc as { parts: object }).parts)).toEqual(['api', 'store']);
    expect(doc).not.toHaveProperty('openapi');
    expect(doc).not.toHaveProperty('tools');
    expect(doc).not.toHaveProperty('secrets');
    expect(DiscoveryDocumentSchema.safeParse(doc).error?.issues).toBeUndefined();
  });

  it('an api-only package with no store: the api part alone', async () => {
    const dir = await hostedPackage(NO_STORE_MANIFEST);
    await writeFile(join(dir, 'openapi.json'), json(OPENAPI));
    const { doc } = await discoveryOf(dir, { 'api-token': 'tok-123' });
    expect(doc).toMatchObject({ parts: { api: {} }, openapi: '/api/hosted/openapi.json' });
    expect((doc as { parts: object }).parts).toEqual({ api: {} });
    expect(DiscoveryDocumentSchema.safeParse(doc).error?.issues).toBeUndefined();
  });

  it('buildTime is the installed package time, the same after a restart; commit stays zeros', async () => {
    const dir = await hostedPackage(NO_STORE_MANIFEST);
    const at = new Date('2026-11-10T12:00:00Z');
    await utimes(join(dir, 'package.json'), at, at);
    const first = (await discoveryOf(dir, { 'api-token': 'tok-123' })).doc;
    await Promise.all(hosted.splice(0).map((h) => h.stop()));
    const again = (await discoveryOf(dir, { 'api-token': 'tok-123' })).doc;
    const build = { commit: '0'.repeat(40), buildTime: '2026-11-10T12:00:00Z' };
    expect(first).toMatchObject(build);
    expect(again).toMatchObject(build);
  });
});
