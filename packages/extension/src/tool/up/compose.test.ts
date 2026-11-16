import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../manifest/read-manifest.js';
import { API_MANIFEST, SPEC_MANIFEST } from '../../test-support/packages.js';
import { CLICKHOUSE_IMAGE, clickhouseUrl, composeFile, STORE_IMAGE } from './compose.js';
import { TRAEFIK_IMAGE } from './gateway.js';

const FULL = validateManifest(SPEC_MANIFEST);
const PARTS = ['pages', 'ui', 'api', 'mcp', 'worker'];
const TAGS = Object.fromEntries(
  PARTS.map((part) => [part, `ghcr.io/agentage/probe-${part}:0.1.0`])
);
const FILES = {
  project: 'agentage-probe-0123abcd',
  recordFile: '/x/.agentage/record.json',
  gatewayFile: '/x/.agentage/gateway.yml',
};
const RECORD_MOUNT = '/x/.agentage/record.json:/run/agentage/agentage-extension.json:ro';
const STORE_URL = 'postgres://probe:agentage-local@store:5432/probe';
// The parts read keys from the issuer over the compose network; the tokens name the same URL.
const HEALTHY = { condition: 'service_healthy' };
const TOKENS = { AGENTAGE_ISSUER: 'http://issuer:3000', AGENTAGE_AUDIENCE: 'localhost' };

type Service = Record<string, unknown>;

const servicesOf = (pkg = FULL, tags = TAGS) =>
  composeFile({ pkg, tags, ...FILES }).services as Record<string, Service>;

describe('composeFile', () => {
  it('has the store, its migrate job, one service per part, the gateway and the issuer', () => {
    const file = composeFile({ pkg: FULL, tags: TAGS, ...FILES });
    expect(file.name).toBe('agentage-probe-0123abcd');
    expect(Object.keys(file.services).sort()).toEqual(
      [...PARTS, 'gateway', 'issuer', 'migrate', 'store'].sort()
    );
    expect(file.volumes).toEqual({ store: {} });
  });

  it('keeps the store on the private network with a health check', () => {
    expect(servicesOf()['store']).toEqual({
      image: STORE_IMAGE,
      environment: {
        POSTGRES_USER: 'probe',
        POSTGRES_PASSWORD: 'agentage-local',
        POSTGRES_DB: 'probe',
      },
      volumes: ['store:/var/lib/postgresql'],
      healthcheck: expect.objectContaining({ test: ['CMD-SHELL', 'pg_isready -U probe -d probe'] }),
    });
    expect(servicesOf()['store']).not.toHaveProperty('ports');
  });

  it('runs migrate from the api image in profile jobs, after the store is healthy', () => {
    expect(servicesOf()['migrate']).toEqual({
      image: TAGS['api'],
      command: ['node', 'dist/store/migrate.js'],
      environment: {
        AGENTAGE_ORIGIN: 'http://localhost:4280',
        ...TOKENS,
        AGENTAGE_RECORD_FILE: '/run/agentage/agentage-extension.json',
        AGENTAGE_STORE_URL: STORE_URL,
      },
      depends_on: { store: { condition: 'service_healthy' } },
      profiles: ['jobs'],
      restart: 'no',
    });
  });

  it('mounts the package seeds into the migrate job only when there are any', () => {
    const seeded = composeFile({ pkg: FULL, tags: TAGS, ...FILES, seedsDir: '/x/seeds' });
    const services = seeded.services as Record<string, Service>;
    expect(services['migrate']?.['volumes']).toEqual(['/x/seeds:/app/seeds:ro']);
    expect(servicesOf()['migrate']).not.toHaveProperty('volumes');
  });

  it('mounts the record into every part; the store reaches every part but ui', () => {
    const services = servicesOf();
    for (const part of PARTS) {
      expect(services[part]).toMatchObject({ image: TAGS[part], volumes: [RECORD_MOUNT] });
      expect(services[part]?.['environment']).toMatchObject({
        AGENTAGE_ORIGIN: 'http://localhost:4280',
        ...TOKENS,
      });
    }
    expect(services['api']).toMatchObject({
      environment: { AGENTAGE_STORE_URL: STORE_URL },
      depends_on: { store: { condition: 'service_healthy' } },
    });
    expect(services['ui']?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL');
    for (const part of PARTS.filter((p) => p !== 'ui'))
      expect(services[part]?.['environment']).not.toHaveProperty('AGENTAGE_DEV_ISSUER');
    expect(services['ui']?.['environment']).toMatchObject({
      AGENTAGE_DEV_ISSUER: 'http://localhost:4281',
    });
    expect(services['ui']?.['depends_on']).toEqual({});
    for (const part of ['pages', 'worker'])
      expect(services[part]?.['depends_on'], part).toEqual({ store: HEALTHY });
    for (const part of ['api', 'mcp'])
      expect(services[part]?.['depends_on'], part).toEqual({ store: HEALTHY, issuer: HEALTHY });
  });

  it('publishes the gateway on 127.0.0.1:4280 and the dev issuer on 127.0.0.1:4281 (C9)', () => {
    const services = servicesOf();
    expect(services['gateway']).toMatchObject({
      image: TRAEFIK_IMAGE,
      ports: ['127.0.0.1:4280:80'],
      volumes: ['/x/.agentage/gateway.yml:/etc/traefik/dynamic.yml:ro'],
    });
    expect(services['issuer']).toEqual({
      image: TAGS['pages'],
      command: ['node', 'node_modules/@agentage/extension/dist/tool/up/dev-issuer.js'],
      ports: ['127.0.0.1:4281:3000'],
      healthcheck: { start_period: '15s', start_interval: '1s' },
      init: true,
    });
  });

  it('mounts each secret file on every part but ui, the top level holding paths only', () => {
    const secretFiles = { 'github-read': '/x/.agentage/secrets/github-read' };
    const file = composeFile({ pkg: FULL, tags: TAGS, ...FILES, secretFiles });
    const services = file.services as Record<string, Service>;
    expect(file.secrets).toEqual({ 'github-read': { file: '/x/.agentage/secrets/github-read' } });
    for (const part of ['pages', 'api', 'mcp', 'worker'])
      expect(services[part]?.['secrets']).toEqual(['github-read']);
    expect(services['ui']).not.toHaveProperty('secrets');
    expect(services['migrate']).not.toHaveProperty('secrets');
    expect(composeFile({ pkg: FULL, tags: TAGS, ...FILES })).not.toHaveProperty('secrets');
  });

  it('mounts a scoped secret only on the parts it names', () => {
    const secrets = ['resend', { name: 'app-key', parts: ['worker'] }];
    const pkg = validateManifest({
      ...SPEC_MANIFEST,
      agentage: { ...SPEC_MANIFEST.agentage, secrets },
    });
    const secretFiles = { resend: '/x/r', 'app-key': '/x/a' };
    const services = composeFile({ pkg, tags: TAGS, ...FILES, secretFiles }).services as Record<
      string,
      Service
    >;
    expect(services['worker']?.['secrets']).toEqual(['resend', 'app-key']);
    for (const part of ['pages', 'api', 'mcp'])
      expect(services[part]?.['secrets']).toEqual(['resend']);
    expect(services['ui']).not.toHaveProperty('secrets');
  });

  it('without a store has no store, no migrate, no volume and no store env', () => {
    const file = composeFile({ pkg: API_MANIFEST, tags: { api: TAGS['api'] ?? '' }, ...FILES });
    const services = file.services as Record<string, Service>;
    expect(Object.keys(services).sort()).toEqual(['api', 'gateway', 'issuer']);
    expect(file.volumes).toEqual({});
    expect(services['api']?.['depends_on']).toEqual({ issuer: HEALTHY });
    expect(services['api']?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL');
  });

  it('with a store but no api part, has the store and no migrate job', () => {
    const pkg = validateManifest({
      ...API_MANIFEST,
      agentage: { id: 'probe', parts: { mcp: true, store: 'postgres' } },
    });
    const services = servicesOf(pkg, { mcp: TAGS['mcp'] ?? '' });
    expect(Object.keys(services).sort()).toEqual(['gateway', 'issuer', 'mcp', 'store']);
    expect(services['store']?.['image']).toBe(STORE_IMAGE);
  });

  describe('a clickhouse store', () => {
    const pkg = validateManifest({
      ...API_MANIFEST,
      agentage: { id: 'probe-x', parts: { api: true, mcp: true, ui: true, store: 'clickhouse' } },
    });
    const tags = { api: 'a', mcp: 'm', ui: 'u' };
    const files = { ...FILES, secretFiles: { 'store-url': '/x/.agentage/secrets/store-url' } };
    const file = composeFile({ pkg, tags, ...files });
    const services = file.services as Record<string, Service>;

    it('has a pinned clickhouse container with a health check, no port, no migrate job', () => {
      expect(services['store']).toEqual({
        image: CLICKHOUSE_IMAGE,
        environment: {
          CLICKHOUSE_USER: 'probe_x',
          CLICKHOUSE_PASSWORD: 'agentage-local',
          CLICKHOUSE_DB: 'probe_x',
        },
        volumes: ['store:/var/lib/clickhouse'],
        healthcheck: expect.objectContaining({
          test: expect.arrayContaining([
            expect.stringContaining('clickhouse-client --user probe_x'),
          ]),
        }),
      });
      expect(services).not.toHaveProperty('migrate');
      expect(file.volumes).toEqual({ store: {} });
      expect(CLICKHOUSE_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    });

    it('mounts the URL file and names it in every part but ui, after the store is healthy', () => {
      for (const part of ['api', 'mcp']) {
        expect(services[part]?.['environment']).toMatchObject({
          AGENTAGE_STORE_URL_FILE: '/run/secrets/store-url',
        });
        expect(services[part]?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL');
        expect(services[part]?.['secrets']).toEqual(['store-url']);
        expect(services[part]?.['depends_on']).toMatchObject({ store: HEALTHY });
      }
      expect(services['ui']?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL_FILE');
      expect(services['ui']).not.toHaveProperty('secrets');
      expect(file.secrets).toEqual({ 'store-url': { file: '/x/.agentage/secrets/store-url' } });
    });

    it('holds a URL of the estate form, user and database from the id', () => {
      expect(clickhouseUrl('probe-x')).toBe('http://probe_x:agentage-local@store:8123/probe_x');
    });
  });

  it('with a git store shares one /data volume across api and mcp, each with its own lock dir', () => {
    const pkg = validateManifest({
      ...API_MANIFEST,
      agentage: { id: 'probe', parts: { api: true, mcp: true, store: 'git' } },
    });
    const file = composeFile({ pkg, tags: { api: 'a', mcp: 'm' }, ...FILES });
    const services = file.services as Record<string, Service>;
    expect(Object.keys(services).sort()).toEqual(['api', 'gateway', 'issuer', 'mcp']);
    expect(file.volumes).toEqual({ store: {} });
    for (const part of ['api', 'mcp']) {
      expect(services[part]?.['volumes']).toEqual([RECORD_MOUNT, 'store:/data']);
      expect(services[part]?.['environment']).toMatchObject({ AGENTAGE_RUN_DIR: '/tmp' });
      expect(services[part]?.['environment']).not.toHaveProperty('AGENTAGE_STORE_URL');
    }
  });
});
