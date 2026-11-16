import { describe, expect, it } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { assertConforms, check, RULES } from './check.js';
import { checkLines } from './format.js';
import { KIT_FLOOR, KIT_VERSION, olderKitMinor } from './kit-version.js';

const stack = { rules: RULES.filter((rule) => rule.name === 'stack') };

const reportOf = async (agentage: string) => {
  const pkg = { ...SPEC_MANIFEST, engines: { agentage }, dependencies: {} };
  return check(await tempPackage({ 'package.json': json(pkg) }), stack);
};

describe('olderKitMinor (D8: KIT_FLOOR up to below the kit)', () => {
  it.each([
    ['^0.14', '0.15.0', '0.14'],
    ['^0.12', '0.15.0', '0.12'],
    ['^0.12.3', '0.15.0', '0.12'],
    ['^0.11', '0.15.0', undefined],
    ['^0.15', '0.15.0', undefined],
    ['^0.16', '0.15.0', undefined],
    ['^1.0', '1.2.0', undefined],
  ])('%s under kit %s: %s', (range, kit, minor) => expect(olderKitMinor(range, kit)).toBe(minor));

  it('the floor is the cli KIT_FLOOR', () => expect(KIT_FLOOR).toBe('0.12'));
});

describe('check of engines.agentage against the running kit', () => {
  const older = `0.${Number(KIT_VERSION.split('.')[1]) - 1}`;

  it('an older minor at or above the floor conforms with one warning line', async () => {
    const report = await reportOf(`^${older}`);
    const warning = `engines.agentage ^${older} is kit ${older}: kit ${KIT_VERSION} runs it (floor ${KIT_FLOOR}), update the extension`;
    expect(report).toMatchObject({ conforms: true, problems: [] });
    expect(report.warnings).toEqual([{ rule: 'stack', problem: warning }]);
    expect(checkLines(report)).toEqual([
      'stack ok',
      `warning stack: ${warning}`,
      'PASS probe 0.1.0 conforms (1 rule)',
    ]);
    const dir = await tempPackage({
      'package.json': json({ ...SPEC_MANIFEST, engines: { agentage: `^${older}` } }),
    });
    await expect(assertConforms(dir, stack)).resolves.toBeUndefined();
  });

  it.each([
    ['below the floor', '^0.11'],
    ['above the running kit', '^0.99'],
  ])('a range %s is refused', async (_name, range) => {
    const report = await reportOf(range);
    expect(report.conforms).toBe(false);
    expect(report.problems).toEqual([
      { rule: 'stack', problem: `kit ${KIT_VERSION} is outside engines.agentage ${range}` },
    ]);
    expect(report).not.toHaveProperty('warnings');
  });

  it('the running minor: no warning, no warnings key', async () => {
    const report = await reportOf(`^${KIT_VERSION.split('.').slice(0, 2).join('.')}`);
    expect(report).toMatchObject({ conforms: true, problems: [] });
    expect(report).not.toHaveProperty('warnings');
  });
});
