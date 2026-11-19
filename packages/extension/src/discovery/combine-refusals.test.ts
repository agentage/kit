import { describe, expect, it } from 'vitest';
import { at, entry, setup } from '../test-support/combine-setup.js';
import { combineHost } from './combine.js';

// A site: the pages part by its image {id}-{part}, nothing else.
const site = (doc: Record<string, unknown>) => {
  const part = 'pages';
  const image = `ghcr.io/agentage/${String(doc['id'])}-${part}@sha256:${'c'.repeat(64)}`;
  const bare = { app: undefined, openapi: undefined, tools: undefined };
  return { ...doc, ...bare, parts: { pages: { image } }, serves: ['pages'] };
};

describe('combineHost checks what it gives', () => {
  it('throws on two installation rows of one id', async () => {
    const { installation } = await setup();
    const rows = [...installation.extensions, installation.extensions[0]!];
    const bad = { ...installation, extensions: rows };
    expect(() => combineHost({ kind: 'cloud', installation: bad, answers: [] })).toThrow(
      /one entry for each id/
    );
  });

  it('throws on a shell package that is not a package name', async () => {
    const { installation } = await setup();
    const bad = { ...installation, shell: { package: 'Not A Package', version: '0.2.0' } };
    expect(() => combineHost({ kind: 'cloud', installation: bad, answers: [] })).toThrow(/shell/);
  });

  it('refuses an answer with the old /api/v1 openapi; its entry is down', async () => {
    const { probe, installation } = await setup();
    const old = { ...probe, openapi: '/api/v1/openapi.json' };
    const out = combineHost({ kind: 'cloud', installation, answers: [at('probe', old)] });
    expect(out.refused).toEqual([
      {
        upstream: 'http://probe:8080',
        reason: 'invalid: openapi: openapi is /api/{id}/openapi.json',
      },
    ]);
    expect(entry(out, 'probe')?.state).toBe('down');
  });

  it('refuses a second pages route; / stays with the first row', async () => {
    const { probe, fixture, installation } = await setup();
    const rows = installation.extensions.map((r) => ({
      ...r,
      expose: { pages: 'public' as const },
    }));
    const answers = [at('probe', site(probe)), at('fixture', site(fixture))];
    const out = combineHost({
      kind: 'cloud',
      installation: { ...installation, extensions: rows },
      answers,
    });
    expect(out.routes).toEqual([
      { prefix: '/', id: 'probe', part: 'pages', upstream: 'http://probe:8080', expose: 'public' },
    ]);
    expect(out.refused).toEqual([
      {
        upstream: 'http://fixture:8080',
        id: 'fixture',
        reason: 'a second pages route: / is probe',
      },
    ]);
  });
});

describe('combineHost takes the state the caller knows', () => {
  it('a failed child with its last good document keeps its app row, and has no route', async () => {
    const { probe, installation } = await setup();
    const out = combineHost({
      kind: 'local',
      installation,
      answers: [at('probe', probe)],
      states: { probe: 'failed' },
    });
    expect(entry(out, 'probe')).toMatchObject({ state: 'failed', app: probe['app'] });
    expect(out.routes).toEqual([]);
  });

  it('a starting child with no document is starting, with no parts', async () => {
    const { installation } = await setup();
    const out = combineHost({
      kind: 'local',
      installation,
      answers: [],
      states: { probe: 'starting' },
    });
    expect(entry(out, 'probe')).toMatchObject({ state: 'starting', parts: [] });
    expect(entry(out, 'probe')).not.toHaveProperty('app');
  });

  it('a disabled row stays disabled whatever the caller says', async () => {
    const { installation } = await setup();
    const rows = installation.extensions.map((r) => ({ ...r, enabled: false }));
    const off = { ...installation, extensions: rows };
    const out = combineHost({
      kind: 'local',
      installation: off,
      answers: [],
      states: { probe: 'failed' },
    });
    expect(entry(out, 'probe')?.state).toBe('disabled');
  });
});
