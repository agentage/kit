import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRecord } from '../discovery/discovery.js';
import { validateManifest } from '../manifest/read-manifest.js';
import { API_MANIFEST, DIGEST, json, SHA, tempPackage } from '../test-support/packages.js';
import { build } from './build.js';
import { pgliteVersion, stageContainer } from './container-stage.js';
import { type Docker, type DockerBuild } from './docker.js';
import { KIT_PGLITE_RANGE } from './kit-version.js';

const ENV = { COMMIT_SHA: SHA, BUILD_TIME: '2026-11-15T10:00:00Z' };
const STORE_MANIFEST = validateManifest({
  ...API_MANIFEST,
  agentage: { ...API_MANIFEST.agentage, parts: { api: true, store: 'postgres' } },
});
const LOCK = {
  lockfileVersion: 3,
  packages: { 'node_modules/@electric-sql/pglite': { version: '0.5.16' } },
};

const fakes = () => {
  const builds: DockerBuild[] = [];
  const pushes: string[] = [];
  const docker: Docker = {
    build: async (built) => void builds.push(built),
    push: async (tag) => (pushes.push(tag), DIGEST),
  };
  return { run: async () => ({ code: 0, stdout: '' }), docker, builds, pushes };
};

const packageDir = (manifest: object = API_MANIFEST, files: Record<string, string> = {}) =>
  tempPackage({
    'package.json': json(manifest),
    'package-lock.json': json({ lockfileVersion: 3 }),
    'dist/api/index.js': 'export const create = () => null;',
    'dist/lib/util.js': 'export const x = 1;',
    'openapi.json': json({ openapi: '3.1.0', info: { version: '0.1.0' }, paths: {} }),
    ...files,
  });

describe('build --container', () => {
  it('builds one image ghcr.io/agentage/{id}:{version} with the one-image labels', async () => {
    const dir = await packageDir();
    const f = fakes();
    const result = await build({ dir, env: ENV, container: true }, { ...f, tmpRoot: dir });
    expect(result).toEqual({
      id: 'probe',
      version: '0.1.0',
      ...{ commit: SHA, buildTime: ENV.BUILD_TIME },
      images: [],
      container: { tag: 'ghcr.io/agentage/probe:0.1.0' },
    });
    expect(f.builds).toHaveLength(1);
    expect(f.builds[0]).toMatchObject({ tag: 'ghcr.io/agentage/probe:0.1.0', buildArgs: ENV });
    expect(f.builds[0]?.labels['org.opencontainers.image.title']).toBe('probe');
    expect(f.pushes).toEqual([]);
  });

  it('with push, writes dist/agentage-container.json: the one image by digest, no part image', async () => {
    const dir = await packageDir();
    const f = fakes();
    const options = {
      dir,
      env: ENV,
      container: true,
      push: true,
      registry: 'localhost:5000/agentage',
    };
    const result = await build(options, { ...f, tmpRoot: dir });
    expect(f.pushes).toEqual(['localhost:5000/agentage/probe:0.1.0']);
    expect(result.recordFile).toBe(join(dir, 'dist', 'agentage-container.json'));
    const record = validateRecord(JSON.parse(await readFile(result.recordFile ?? '', 'utf8')));
    expect(record.image).toBe(`localhost:5000/agentage/probe@${DIGEST}`);
    expect(record.parts).toEqual({});
    expect(record.openapi).toBe('/api/probe/openapi.json');
    expect(await readdir(join(dir, 'dist'))).not.toContain('agentage-extension.json');
  });
});

describe('container context', () => {
  it('carries all of dist, the OpenAPI file, the migrations and PGlite at the locked version; no seeds', async () => {
    const files = {
      'package-lock.json': json(LOCK),
      'migrations/001-echoes.sql': 'create table echoes (id int);',
      'seeds/001.sql': 'insert into echoes values (1);',
    };
    const dir = await packageDir(STORE_MANIFEST, files);
    const root = await stageContainer(dir, STORE_MANIFEST, dir);
    expect((await readdir(join(root, 'app'))).sort()).toEqual([
      'dist',
      'migrations',
      'openapi.json',
      'package.json',
    ]);
    expect((await readdir(join(root, 'app', 'dist'))).sort()).toEqual(['api', 'lib']);
    expect(await readdir(join(root, 'deps'))).toEqual(
      expect.arrayContaining(['package-lock.json'])
    );
    expect(await readFile(join(root, 'Dockerfile'), 'utf8')).toContain(
      '@electric-sql/pglite@0.5.16'
    );
  });

  it('takes the kit peer range when the lock has no PGlite, and none without a postgres store', async () => {
    expect(await pgliteVersion(await packageDir())).toBe(KIT_PGLITE_RANGE);
    const dir = await packageDir();
    const recipe = await readFile(
      join(await stageContainer(dir, API_MANIFEST, dir), 'Dockerfile'),
      'utf8'
    );
    expect(recipe).not.toContain('pglite');
  });

  it('refuses a part the package build did not write', async () => {
    const dir = await tempPackage({
      'package.json': json(API_MANIFEST),
      'package-lock.json': '{}',
    });
    await expect(stageContainer(dir, API_MANIFEST, dir)).rejects.toThrow(
      'dist/api/index.js not found'
    );
  });
});
