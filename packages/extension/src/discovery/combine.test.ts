import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { combineHost, type Answer, type HostInstallation } from './combine.js';
import { HostDocumentSchema } from './host-document.schema.js';

const FIXTURES = join(import.meta.dirname, '..', 'test-support', 'combine');
const read = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

const setup = async () => ({
  probe: await read('probe.json'),
  fixture: await read('fixture.json'),
  installation: (await read('installation.json')) as unknown as HostInstallation,
});

const at = (id: string, document: unknown): Answer => ({ upstream: `http://${id}:8080`, document });

const entry = (out: ReturnType<typeof combineHost>, id: string) =>
  out.document.extensions.find((e) => e.id === id);

describe('combineHost', () => {
  it('two documents and one installation equal the golden file', async () => {
    const { probe, fixture, installation } = await setup();
    const answers = [at('probe', probe), at('fixture', fixture), at('relay', null)];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out).toEqual(await read('combined.golden.json'));
    expect(HostDocumentSchema.parse(out.document)).toEqual(out.document);
  });

  it('no answer = down: no commit, no parts, no route', async () => {
    const { fixture, installation } = await setup();
    const out = combineHost({ kind: 'cloud', installation, answers: [at('fixture', fixture)] });
    expect(entry(out, 'probe')).toEqual({
      id: 'probe',
      version: '0.4.0',
      parts: [],
      expose: { api: 'public', mcp: 'public', app: 'public' },
      state: 'down',
    });
    expect(out.routes.filter((r) => r.id === 'probe')).toEqual([]);
  });

  it('a document that fails the schema is refused, and its entry is down', async () => {
    const { probe, installation } = await setup();
    const answers = [at('probe', { ...probe, serves: undefined })];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(entry(out, 'probe')?.state).toBe('down');
    expect(out.refused).toEqual([
      { upstream: 'http://probe:8080', reason: expect.stringMatching(/^invalid: serves/) },
    ]);
  });

  it('unknown id = refused: not an entry, no route', async () => {
    const { probe, installation } = await setup();
    const stray = { ...probe, id: 'stray', openapi: '/api/stray/openapi.json', tools: undefined };
    const app = {
      ...(probe['app'] as object),
      entry: '/app/stray/app-1.js',
      css: '/app/stray/app-1.css',
    };
    const out = combineHost({
      kind: 'cloud',
      installation,
      answers: [at('stray', { ...stray, app })],
    });
    expect(out.refused).toEqual([
      { upstream: 'http://stray:8080', id: 'stray', reason: 'unknown id' },
    ]);
    expect(entry(out, 'stray')).toBeUndefined();
    expect(out.routes).toEqual([]);
  });

  it('another version than the installation is refused', async () => {
    const { probe, installation } = await setup();
    const out = combineHost({
      kind: 'cloud',
      installation,
      answers: [at('probe', { ...probe, version: '0.3.9' })],
    });
    expect(out.refused).toEqual([
      { upstream: 'http://probe:8080', id: 'probe', reason: 'version 0.3.9, not 0.4.0' },
    ]);
    expect(entry(out, 'probe')?.state).toBe('down');
  });

  it('a part not reported = no route, even when it is exposed', async () => {
    const { fixture, installation } = await setup();
    const out = combineHost({ kind: 'cloud', installation, answers: [at('fixture', fixture)] });
    expect(entry(out, 'fixture')?.expose).toEqual({ api: 'internal', mcp: 'public' });
    expect(out.routes.map((r) => r.prefix)).toEqual(['/api/fixture']);
  });

  it('a part reported but not exposed = no route', async () => {
    const { probe, installation } = await setup();
    const rows = installation.extensions.map((r) => (r.id === 'probe' ? { ...r, expose: {} } : r));
    const out = combineHost({
      kind: 'cloud',
      installation: { ...installation, extensions: rows },
      answers: [at('probe', probe)],
    });
    expect(entry(out, 'probe')?.state).toBe('running');
    expect(out.routes).toEqual([]);
  });

  it('two containers of one id = one entry; each part routes to the container that serves it', async () => {
    const { probe, installation } = await setup();
    const api = { ...probe, serves: ['api', 'worker'], app: undefined };
    const rest = { ...probe, serves: ['mcp', 'app'] };
    const answers = [
      { upstream: 'http://probe-api:8080', document: api },
      { upstream: 'http://probe-mcp:8080', document: rest },
    ];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out.document.extensions.filter((e) => e.id === 'probe')).toHaveLength(1);
    expect(entry(out, 'probe')?.parts).toEqual(['api', 'mcp', 'worker', 'app']);
    expect(out.routes.map((r) => [r.prefix, r.upstream])).toEqual([
      ['/api/probe', 'http://probe-api:8080'],
      ['/mcp/probe', 'http://probe-mcp:8080'],
      ['/app/probe', 'http://probe-mcp:8080'],
    ]);
  });

  it('two containers of one id from two builds: the second is refused', async () => {
    const { probe, installation } = await setup();
    const other = { ...probe, commit: 'f'.repeat(40) };
    const answers = [at('probe', probe), { upstream: 'http://probe-2:8080', document: other }];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(entry(out, 'probe')?.commit).toBe(probe['commit']);
    expect(out.refused).toEqual([
      {
        upstream: 'http://probe-2:8080',
        id: 'probe',
        reason: `another build than ${String(probe['commit'])}`,
      },
    ]);
  });

  it('a disabled row is disabled: its answer is refused, no route', async () => {
    const { probe, installation } = await setup();
    const rows = installation.extensions.map((r) =>
      r.id === 'probe' ? { ...r, enabled: false } : r
    );
    const out = combineHost({
      kind: 'cloud',
      installation: { ...installation, extensions: rows },
      answers: [at('probe', probe)],
    });
    expect(entry(out, 'probe')).toMatchObject({ state: 'disabled', parts: [] });
    expect(out.refused).toEqual([
      { upstream: 'http://probe:8080', id: 'probe', reason: 'disabled' },
    ]);
    expect(out.routes).toEqual([]);
  });

  it('pages route at / after every other route, for the first row that exposes them', async () => {
    const { probe, installation } = await setup();
    const image = (part: string) => ({
      image: `ghcr.io/agentage/probe-${part}@sha256:${'c'.repeat(64)}`,
    });
    const parts = { pages: image('pages'), api: image('api') };
    const site = { ...probe, parts, serves: ['pages', 'api'], app: undefined };
    const rows = installation.extensions.map((r) =>
      r.id === 'probe' ? { ...r, expose: { pages: 'public' as const, api: 'public' as const } } : r
    );
    const out = combineHost({
      kind: 'cloud',
      installation: { ...installation, extensions: rows },
      answers: [at('probe', site)],
    });
    expect(out.routes.map((r) => [r.prefix, r.part])).toEqual([
      ['/api/probe', 'api'],
      ['/', 'pages'],
    ]);
  });
});
