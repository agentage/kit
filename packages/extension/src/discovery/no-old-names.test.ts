// J.4.1 row 7 as a unit test: the combine and route-table sources never name the old `'memory'` or `-pages`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OLD_NAMES = /'memory'|-pages/;
const NAMED = /^(combine|route-table)/;

// As the card glob under grep -r: any file type, and every file in a matched folder.
const listTargets = (dir: string, inside = false): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const hit = inside || NAMED.test(e.name);
    if (e.isDirectory()) return listTargets(join(dir, e.name), hit);
    return hit ? [join(dir, e.name)] : [];
  });

const sources = (): string[] =>
  readdirSync(PACKAGES)
    .map((p) => join(PACKAGES, p, 'src'))
    .filter((src) => existsSync(src))
    .flatMap((src) => listTargets(src));

const findHits = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .flatMap(([file, text]) =>
      text.split('\n').map((line, i) => (OLD_NAMES.test(line) ? `${file}:${i + 1}: ${line}` : ''))
    )
    .filter(Boolean);

describe('combine and route-table sources carry no old names (J.4.1 row 7)', () => {
  const files = sources();

  it('scans the real files, never an empty list', () => {
    const names = files.map((f) => f.split('/').pop());
    expect(names).toEqual(
      expect.arrayContaining(['combine.ts', 'route-table.ts', 'combined.golden.json'])
    );
  });

  it('finds no `memory` literal and no -pages suffix', () => {
    const texts = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));
    expect(findHits(texts)).toEqual([]);
  });

  it('reports a planted old name', () => {
    expect(findHits({ 'x.ts': "const a = 1;\nconst id = 'memory';" })).toEqual([
      "x.ts:2: const id = 'memory';",
    ]);
    expect(findHits({ 'y.ts': 'const s = `${id}-pages`;' })).toHaveLength(1);
    expect(findHits({ 'z.ts': 'const ok = "memory";' })).toEqual([]);
  });
});
