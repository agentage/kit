import { describe, expect, it } from 'vitest';
import { DiscoveryDocumentSchema, toolsAreOwn } from '../discovery/discovery.schema.js';
import { createToolRegistry, prefixed } from '../mcp/tools.js';
import { ExtensionIdSchema, ownsTool, PrefixedToolNameSchema } from './primitives.schema.js';

const name = (value: string) => PrefixedToolNameSchema.safeParse(value).success;

describe('tool names: {id}_{name}, the old {id}__{name} still read', () => {
  it('the kit serves {id}_{name}', () => {
    expect([prefixed('probe', 'echo'), prefixed('a-b', 'list_all')]).toEqual([
      'probe_echo',
      'a-b_list_all',
    ]);
  });

  it('the name schema takes both forms and nothing else', () => {
    expect(['probe_echo', 'probe__echo', 'a-b_x', 'a_list_all'].map(name)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      ['probe', 'probe___echo', 'probe_', '_echo', 'probe_Echo', 'probe_1x'].map(name)
    ).toEqual([false, false, false, false, false, false]);
  });

  it('an id owns its tools in both forms, never a tool of a longer id', () => {
    expect([ownsTool('probe', 'probe_echo'), ownsTool('probe', 'probe__echo')]).toEqual([
      true,
      true,
    ]);
    const foreign = [
      'probex_echo',
      'probex__echo',
      'probe___echo',
      'probe-x_echo',
      'probe',
      'a_echo',
    ];
    expect(foreign.filter((tool) => ownsTool('probe', tool))).toEqual([]);
    expect(ownsTool('a', 'a-b_x')).toBe(false);
    expect(toolsAreOwn({ id: 'p', tools: [{ name: 'p_a' }, { name: 'p__b' }] })).toBe(true);
    expect(toolsAreOwn({ id: 'p', tools: [{ name: 'p_a' }, { name: 'q_b' }] })).toBe(false);
  });

  it('the split is unambiguous: an id holds no _, a tool name starts with a letter', () => {
    expect(ExtensionIdSchema.safeParse('a_b').success).toBe(false);
    const { tool } = createToolRegistry();
    const spec = { description: 'x', input: {} as never };
    expect(() => tool('_x', spec, () => ({}))).toThrow('lowercase, digits, _ and -');
  });

  it('a discovery document refuses a tool of another id in either form', async () => {
    const doc = (tools: { name: string }[]) =>
      DiscoveryDocumentSchema.safeParse({ ...base, tools: tools.map(publicTool) }).success;
    expect([
      doc([{ name: 'probe_a' }, { name: 'probe__b' }]),
      doc([{ name: 'probex__a' }]),
    ]).toEqual([true, false]);
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
