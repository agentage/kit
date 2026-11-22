import { describe, expect, it } from 'vitest';
import { at, entry, setup } from '../test-support/combine-setup.js';
import { entryRefusal } from './combine-answers.js';
import { combineHost } from './combine.js';
import { type DiscoveryDocument } from './discovery.schema.js';

const TOOLS_ISSUE = 'tools: every tool is {id}_{name}';
const poison = (doc: Record<string, unknown>) => ({
  ...doc,
  tools: [{ name: 'other_x', scope: 'public' }],
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

  it('takes one answer in the new form and one in the old form: both run', async () => {
    const { probe, fixture, installation } = await setup();
    const tools = (name: string) => [{ name, scope: 'public' }];
    const answers = [
      at('probe', { ...probe, tools: tools('probe_echo') }),
      at('fixture', { ...fixture, tools: tools('fixture__echo') }),
    ];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out.refused).toEqual([]);
    expect([entry(out, 'probe')?.state, entry(out, 'fixture')?.state]).toEqual([
      'running',
      'running',
    ]);
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

  it.each([
    ['after', false],
    ['before', false],
    ['before, with another commit', true],
  ])('refuses an unlisted answer for a listed id, %s the listed one', async (order, rebuilt) => {
    const { probe, installation } = await setup();
    const listed = { ...at('probe', probe), expectedId: 'probe' };
    const document = rebuilt ? { ...probe, commit: 'f'.repeat(40) } : probe;
    const stray = { upstream: 'http://stray:8080', document };
    const answers = order === 'after' ? [listed, stray] : [stray, listed];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out.refused).toEqual([
      { upstream: 'http://stray:8080', id: 'probe', reason: 'not listed for this id' },
    ]);
    expect(entry(out, 'probe')).toMatchObject({ state: 'running', commit: probe['commit'] });
    expect(out.routes.every((r) => r.upstream === 'http://probe:8080')).toBe(true);
    expect(out.routes.length).toBeGreaterThan(0);
  });

  it('merges two unlisted answers of one id, as before', async () => {
    const { probe, installation } = await setup();
    const answers = [at('probe', probe), { upstream: 'http://probe-2:8080', document: probe }];
    const out = combineHost({ kind: 'cloud', installation, answers });
    expect(out.refused).toEqual([]);
    expect(entry(out, 'probe')?.state).toBe('running');
  });
});
