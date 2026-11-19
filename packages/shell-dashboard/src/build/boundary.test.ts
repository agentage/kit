// J.4.5 rows 2 to 5 as tests: the shell is a library, not an extension, and reads only its host.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(PKG, 'src');

const filesOf = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesOf(join(dir, e.name)) : [join(dir, e.name)]
  );

// Built from parts, so this file never matches the card greps it enforces.
const RULES: Record<string, RegExp> = {
  'reads the host data, never the host config (row 3)': new RegExp(['install', 'ation'].join('')),
  'imports no extension package (row 4)': new RegExp(`from '@agentage/${'extension'}`),
  'leaves install and remove to the host (row 5)': new RegExp(
    [`npm ${'install'}`, `extensions${'\\.json'}`].join('|')
  ),
  'has no extension entry function (row 2)': new RegExp(`\\b${'create'}\\s*\\(\\s*ctx\\b`),
};

const hitsOf = (rule: RegExp): string[] =>
  filesOf(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (rule.test(line) ? [`${relative(PKG, file)}:${i + 1}`] : []))
  );

describe('the shell is a library, not an extension (J.4.5)', () => {
  it('has no extension manifest in package.json (row 2)', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as object;
    expect(Object.keys(pkg)).not.toContain('agentage');
  });

  it('builds no container (row 2)', () => {
    expect(existsSync(join(PKG, 'Dockerfile'))).toBe(false);
  });

  for (const [name, rule] of Object.entries(RULES))
    it(`source ${name}`, () => expect(hitsOf(rule)).toEqual([]));

  it('a rule finds a planted line', () => {
    const planted = `import x ${`from '@agentage/${'extension'}/app'`};`;
    expect(RULES['imports no extension package (row 4)']?.test(planted)).toBe(true);
  });
});
