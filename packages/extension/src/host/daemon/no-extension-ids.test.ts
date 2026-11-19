// J.4.3 row 6 as a test: the lint rule of the app host program refuses an extension id literal.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const AT = join(ROOT, 'packages/extension/src/host/daemon/planted.ts');

const errorsOf = async (text: string) => {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: { languageOptions: { parserOptions: { project: null } } },
  });
  const [result] = await eslint.lintText(text, { filePath: AT });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax');
};

describe('no extension id in the app host program (J.4.3 row 6)', () => {
  it('refuses an id as a string and as a template part', async () => {
    expect(await errorsOf("export const a = 'market';\n")).toHaveLength(1);
    expect(await errorsOf('export const b = `logs`;\n')).toHaveLength(1);
  });

  it('allows a word that only contains an id, and an id read from data', async () => {
    expect(await errorsOf("export const c = 'marketplace';\n")).toEqual([]);
    expect(await errorsOf('export const d = (row: { id: string }) => row.id;\n')).toEqual([]);
  });
});
