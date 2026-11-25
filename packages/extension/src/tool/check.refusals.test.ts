import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { check, RULES } from './check.js';

const entries = { rules: RULES.filter((rule) => rule.name === 'entries') };

describe('the first refusals a caller meets', () => {
  it('a folder without package.json, or no folder at all, says package.json is missing', async () => {
    const empty = await tempPackage({});
    for (const dir of [empty, join(empty, 'not-here')]) {
      expect((await check(dir)).problems).toEqual([
        {
          rule: 'manifest',
          file: 'package.json',
          problem: 'is missing: run it in an extension package folder',
        },
      ]);
    }
  });

  it('a package with no agentage key is refused as not an extension, in one line', async () => {
    const dir = await tempPackage({ 'package.json': json({ name: '@x/lib', version: '1.0.0' }) });
    expect((await check(dir)).problems).toEqual([
      { rule: 'manifest', file: 'package.json', problem: 'has no agentage key: not an extension' },
    ]);
  });

  it('a package never built is one entries line that says to build it first', async () => {
    const dir = await tempPackage({ 'package.json': json(SPEC_MANIFEST) });
    expect((await check(dir, entries)).problems).toEqual([
      {
        rule: 'entries',
        file: 'dist',
        problem: 'is missing: build the package first (npm run build)',
      },
    ]);
  });

  it('a part that throws at import is named with the error', async () => {
    const api = { ...SPEC_MANIFEST, agentage: { ...SPEC_MANIFEST.agentage, parts: { api: true } } };
    const files = { 'package.json': json(api), 'dist/api/index.js': 'throw new Error("boom");' };
    expect((await check(await tempPackage(files), entries)).problems).toEqual([
      { rule: 'entries', problem: 'part api fails at import: boom' },
    ]);
  });

  it('a built package without its cli entry says so in one relative line', async () => {
    const cli = { ...SPEC_MANIFEST, agentage: { ...SPEC_MANIFEST.agentage, parts: { cli: true } } };
    const files = { 'package.json': json(cli), 'dist/keep.txt': '' };
    expect((await check(await tempPackage(files), entries)).problems).toEqual([
      {
        rule: 'entries',
        problem: 'dist/cli/index.js not found: the package build must write the cli part there',
      },
    ]);
  });
});

describe('the app part needs the components', () => {
  const app = (extra: object) => ({
    ...SPEC_MANIFEST,
    ...extra,
    agentage: { ...SPEC_MANIFEST.agentage, parts: { app: true }, app: { title: 'Probe' } },
  });
  const deps = (spec?: string, old?: string) => ({
    dependencies: {
      ...(spec ? { '@agentage/components': spec } : {}),
      ...(old ? { '@agentage/design-system': old } : {}),
    },
  });
  const run = async (extra: object) =>
    (
      await check(
        await tempPackage({ 'package.json': json(app(extra)), 'dist/app/index.js': '' }),
        entries
      )
    ).problems.map((p) => p.problem);
  const SWITCH =
    '@agentage/design-system is replaced: switch the app part to @agentage/components ^0.21';

  it('refuses an app part that declares neither', async () => {
    expect(await run(deps())).toEqual([
      'the app part needs @agentage/components ^0.21: declare it in dependencies, devDependencies or peerDependencies',
    ]);
  });

  it('refuses a range below 0.21 and accepts ^0.21 and 0.21.0', async () => {
    expect(await run(deps('^0.20.1'))).toEqual([
      '@agentage/components ^0.20.1, the app part needs ^0.21',
    ]);
    expect(await run(deps('^0.21.0'))).toEqual([]);
    expect(await run(deps('0.21.0'))).toEqual([]);
  });

  it('tells an app part on the old library alone to switch', async () => {
    expect(await run(deps(undefined, '^0.20.1'))).toEqual([SWITCH]);
    expect(await run({ peerDependencies: { '@agentage/design-system': '^0.20' } })).toEqual([
      SWITCH,
    ]);
  });

  it('only warns when the old library is declared beside the new one', async () => {
    const dir = await tempPackage({
      'package.json': json(app(deps('0.21.0', '0.20.1'))),
      'dist/app/index.js': '',
    });
    const report = await check(dir, entries);
    expect(report.problems).toEqual([]);
    expect(report.warnings?.map((w) => w.problem)).toEqual([
      '@agentage/design-system is replaced by @agentage/components: remove it',
    ]);
    expect(await run(deps('^0.20.0', '0.20.1'))).toEqual([
      '@agentage/components ^0.20.0, the app part needs ^0.21',
    ]);
  });
});
