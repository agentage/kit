import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { json, tempPackage } from '../test-support/packages.js';
import { kitPgliteVersion, KIT_VERSION } from './kit-version.js';

describe('KIT_VERSION', () => {
  it('is the version of the kit package itself', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    ) as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe('@agentage/extension');
    expect(KIT_VERSION).toBe(pkg.version);
  });
});

describe('kitPgliteVersion', () => {
  it('is the exact version of the PGlite copy the kit resolves, none when there is none', async () => {
    expect(kitPgliteVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    const dir = await tempPackage({
      'node_modules/@electric-sql/pglite/package.json': json({ version: '0.5.15' }),
      'a/b/x.txt': '',
    });
    expect(kitPgliteVersion(`${dir}/a/b`)).toBe('0.5.15');
    expect(kitPgliteVersion('/')).toBeUndefined();
  });
});
