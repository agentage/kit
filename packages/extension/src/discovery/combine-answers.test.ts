import { describe, expect, it } from 'vitest';
import { at, entry, setup } from '../test-support/combine-setup.js';
import { entryRefusal } from './combine-answers.js';
import { combineHost } from './combine.js';
import { type DiscoveryDocument } from './discovery.schema.js';

const TOOLS_ISSUE = 'tools: every tool is {id}__{name}';
const poison = (doc: Record<string, unknown>) => ({
  ...doc,
  tools: [{ name: 'other__x', scope: 'public' }],
});

describe('combineHost never throws on one bad answer', () => {
  it('refuses a poisoned answer among good ones; the rest combines', async () => {
    const { probe, fixture, installation } = await setup();
    const answers = [at('probe', poison(probe)), at('fixture', fixture)];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out.refused).toEqual([
      { upstream: 'http://probe:8080', reason: `invalid: ${TOOLS_ISSUE}` },
    ]);
    expect(entry(out, 'probe')?.state).toBe('down');
    expect(entry(out, 'fixture')?.state).toBe('running');
    expect(out.routes.map((r) => r.id)).toEqual(['fixture']);
  });

  it('refuses every answer when all are poisoned: each entry is down, no route', async () => {
    const { probe, fixture, installation } = await setup();
    const answers = [at('probe', poison(probe)), at('fixture', poison(fixture))];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out.refused.map((r) => r.upstream)).toEqual([
      'http://probe:8080',
      'http://fixture:8080',
    ]);
    expect(out.document.extensions.map((e) => e.state)).toEqual(['down', 'down', 'down']);
    expect(out.routes).toEqual([]);
  });

  it('the entry check refuses a document the host schema would refuse', async () => {
    const { probe } = await setup();
    expect(entryRefusal(probe as DiscoveryDocument)).toBeNull();
    const bad = poison(probe) as DiscoveryDocument;
    expect(entryRefusal(bad)).toBe(`invalid entry: ${TOOLS_ISSUE}`);
  });
});

describe('combineHost checks the id each container was listed for', () => {
  it('refuses a container listed as fixture that answers as probe; probe keeps its entry', async () => {
    const { probe, installation } = await setup();
    const impostor = { ...at('fixture', probe), expectedId: 'fixture' };
    const own = { ...at('probe', probe), expectedId: 'probe' };
    const out = combineHost({ kind: 'cloud', installation, answers: [impostor, own] });
    expect(out.refused).toEqual([
      { upstream: 'http://fixture:8080', id: 'fixture', reason: 'claims another id: probe' },
    ]);
    expect(entry(out, 'fixture')?.state).toBe('down');
    expect(entry(out, 'probe')?.state).toBe('running');
    const upstreams = new Set(out.routes.map((r) => `${r.id} ${r.upstream}`));
    expect([...upstreams]).toEqual(['probe http://probe:8080']);
  });

  it('merges an answer with the expected id and one with none into one entry', async () => {
    const { probe, installation } = await setup();
    const listed = { ...at('probe', probe), expectedId: 'probe' };
    const second = { upstream: 'http://probe-2:8080', document: probe };
    const out = combineHost({ kind: 'cloud', installation, answers: [listed, second] });
    expect(out.refused).toEqual([]);
    expect(out.document.extensions.filter((e) => e.id === 'probe')).toHaveLength(1);
    expect(out.routes.every((r) => r.upstream === 'http://probe:8080')).toBe(true);
  });
});
