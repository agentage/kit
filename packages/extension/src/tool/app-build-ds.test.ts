import { mkdir, readFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, tempPackage } from '../test-support/packages.js';
import { buildApp } from './app-build.js';

const PKG = {
  ...API_MANIFEST,
  agentage: { id: 'probe', parts: { api: true, app: true }, app: { title: 'Probe' } },
};
const cssOf = async (dir: string) =>
  readFile(join(dir, 'dist/app', (await buildApp(dir)).css), 'utf8');

describe('the app css scans the components files the app bundles (L3 bug 2)', () => {
  it('a class only in a bundled components file is in the css; an unused file is not', async () => {
    const lib = 'node_modules/@agentage/components';
    const dir = await tempPackage({
      'package.json': json(PKG),
      'src/app/index.tsx': `import { Pill } from '@agentage/components/pill';
export default function Probe() { return <Pill />; }
`,
      [`${lib}/package.json`]: json({
        name: '@agentage/components',
        exports: { './pill': './dist/pill.js', './other': './dist/other.js' },
      }),
      [`${lib}/dist/pill.js`]: `export const Pill = () => ({ className: 'rounded-full px-7 tracking-widest' });\n`,
      [`${lib}/dist/other.js`]: `export const Other = () => ({ className: 'skew-x-12' });\n`,
    });
    const css = await cssOf(dir);
    expect(css).toContain('.px-7');
    expect(css).toContain('.tracking-widest');
    expect(css).not.toContain('.skew-x-12');
  });

  it('the real Button gets its classes: tokens, the 28 px height and the focus-ring utility', async () => {
    const real = dirname(
      createRequire(import.meta.url).resolve('@agentage/components/package.json')
    );
    const dir = await tempPackage({
      'package.json': json(PKG),
      'src/app/index.tsx': `import { Button } from '@agentage/components/button';
export default function Probe() { return <Button>Ping</Button>; }
`,
    });
    await mkdir(join(dir, 'node_modules/@agentage'), { recursive: true });
    await symlink(real, join(dir, 'node_modules/@agentage/components'), 'dir');
    const css = await cssOf(dir);
    expect(css).toContain('.bg-primary');
    expect(css).toContain('.h-7');
    expect(css).toContain('.text-ui');
    expect(css).toContain('.focus-ring');
    expect(css).not.toMatch(/:root|data-theme/);
  });
});
