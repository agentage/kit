import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DiscoveryDocumentSchema, toolsAreOwn } from '../discovery/discovery.schema.js';
import { createToolRegistry, prefixed } from '../mcp/tools.js';
import { ExtensionIdSchema, ownsTool, PrefixedToolNameSchema } from './primitives.schema.js';

const name = (value: string) => PrefixedToolNameSchema.safeParse(value).success;

const CASES_FILE = new URL('../../../../test-support/tool-name-cases.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(CASES_FILE, 'utf8')) as {
  cases: { id: string; name: string; expected: boolean }[];
};

// The old two-underscore form, built so that no literal of it stays in the tests.
const OLD_SEP = '_'.repeat(2);
const old = (id: string, tool: string) => `${id}${OLD_SEP}${tool}`;

describe('tool names: only {id}_{name}, the old form is refused', () => {
  it('the kit serves {id}_{name}', () => {
    expect([prefixed('probe', 'echo'), prefixed('a-b', 'list_all')]).toEqual([
      'probe_echo',
      'a-b_list_all',
    ]);
  });

  it('the name schema takes the one-underscore form and nothing else', () => {
    expect(['probe_echo', 'a-b_x', 'a_list_all'].map(name)).toEqual([true, true, true]);
    expect(
      [old('probe', 'echo'), 'probe', 'probe_', '_echo', 'probe_Echo', 'probe_1x'].map(name)
    ).toEqual([false, false, false, false, false, false]);
  });

  it('an id owns its tools, never a tool of a longer id or an old-form name', () => {
    expect(ownsTool('probe', 'probe_echo')).toBe(true);
    const foreign = [
      'probex_echo',
      old('probex', 'echo'),
      old('probe', 'echo'),
      'probe-x_echo',
      'probe',
      'a_echo',
    ];
    expect(foreign.filter((tool) => ownsTool('probe', tool))).toEqual([]);
    expect(ownsTool('a', 'a-b_x')).toBe(false);
    expect(toolsAreOwn({ id: 'p', tools: [{ name: 'p_a' }, { name: 'p_b' }] })).toBe(true);
    expect(toolsAreOwn({ id: 'p', tools: [{ name: 'p_a' }, { name: old('p', 'b') }] })).toBe(false);
    expect(toolsAreOwn({ id: 'p', tools: [{ name: 'p_a' }, { name: 'q_b' }] })).toBe(false);
  });

  it('ownsTool agrees with the cases shared with the widget bridge', () => {
    const got = cases.map((c) => ownsTool(c.id, c.name.replace('{old}', OLD_SEP)));
    expect(got).toEqual(cases.map((c) => c.expected));
  });

  it('the split is unambiguous: an id holds no _, a tool name starts with a letter', () => {
    expect(ExtensionIdSchema.safeParse('a_b').success).toBe(false);
    const { tool } = createToolRegistry();
    const spec = { description: 'x', input: {} as never };
    expect(() => tool('_x', spec, () => ({}))).toThrow('lowercase, digits, _ and -');
  });

  it('a discovery document refuses a tool of another id and a tool in the old form', async () => {
    const doc = (tools: { name: string }[]) =>
      DiscoveryDocumentSchema.safeParse({ ...base, tools: tools.map(publicTool) }).success;
    expect([
      doc([{ name: 'probe_a' }, { name: 'probe_b' }]),
      doc([{ name: 'probex_a' }]),
      doc([{ name: old('probe', 'b') }]),
    ]).toEqual([true, false, false]);
  });
});

const publicTool = ({ name: n }: { name: string }) => ({ name: n, scope: 'public' });

const base = {
  id: 'probe',
  version: '1.0.0',
  commit: 'a'.repeat(40),
  buildTime: '2026-11-19T00:00:00Z',
  host: 'http://127.0.0.1:1',
  parts: { api: {} },
  serves: ['api'],
};
