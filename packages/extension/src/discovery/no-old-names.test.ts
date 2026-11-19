// J.4.1 row 7 as a unit test: the combine and route-table sources never name the old `'memory'` or `-pages`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_NAMES = /'memory'|-pages/;

// Test files are in scope: the card glob includes them.
const isTarget = (name: string): boolean =>
  /^(combine|route-table)/.test(name) && name.endsWith('.ts');

const listTargets = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listTargets(join(dir, e.name)) : isTarget(e.name) ? [join(dir, e.name)] : []
  );

const findHits = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .flatMap(([file, text]) =>
      text.split('\n').map((line, i) => (OLD_NAMES.test(line) ? `${file}:${i + 1}: ${line}` : ''))
    )
    .filter(Boolean);

describe('combine and route-table sources carry no old names (J.4.1 row 7)', () => {
  const files = listTargets(SRC);

  it('scans the real files, never an empty list', () => {
    const names = files.map((f) => f.split('/').pop());
    expect(names).toEqual(expect.arrayContaining(['combine.ts', 'route-table.ts']));
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
