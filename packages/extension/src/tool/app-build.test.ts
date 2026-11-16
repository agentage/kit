import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, tempPackage } from '../test-support/packages.js';
import { requireBuildDeps } from './app-load.js';
import { APP_EXTERNALS, appBuilder, buildApp } from './app-build.js';
import { check, RULES } from './check.js';

const APP = `import { useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useAppHost } from '@agentage/app';
export default function Probe() {
  const [n] = useState(0);
  void [createPortal, createRoot];
  return <h1 className="text-amber-300 p-4">{useAppHost().id} {n} v1</h1>;
}
`;

const PKG = {
  ...API_MANIFEST,
  agentage: { id: 'probe', parts: { api: true, app: true }, app: { title: 'Probe' } },
};

const appPackage = (code = APP) =>
  tempPackage({ 'package.json': json(PKG), 'src/app/index.tsx': code });

const read = (dir: string, name: string) => readFile(join(dir, 'dist/app', name), 'utf8');

describe('the app build (S1.2.2 row 7, K4)', () => {
  it('writes the hashed js and css, index.js and app.json naming them', async () => {
    const dir = await appPackage();
    const files = await buildApp(dir);
    expect(files).toEqual({
      entry: expect.stringMatching(/^app-[0-9a-f]{10}\.js$/),
      css: expect.stringMatching(/^app-[0-9a-f]{10}\.css$/),
    });
    expect(JSON.parse(await read(dir, 'app.json'))).toEqual(files);
    expect(await read(dir, 'index.js')).toBe(`export { default } from './${files.entry}';\n`);
    expect((await readdir(join(dir, 'dist/app'))).sort()).toEqual(
      ['app.json', 'index.js', files.css, files.entry].sort()
    );
  });

  it('keeps the five shared imports bare: React and @agentage/app are not bundled', async () => {
    const dir = await appPackage();
    const code = await read(dir, (await buildApp(dir)).entry);
    for (const spec of APP_EXTERNALS) expect(code).toContain(`"${spec}"`);
    expect(code).not.toContain('react.production');
    expect(code.length).toBeLessThan(2000);
  });

  it('css: utilities of src/app only; no preflight, no theme variables', async () => {
    const dir = await appPackage();
    const css = await read(dir, (await buildApp(dir)).css);
    expect(css).toContain('.text-amber-300');
    expect(css).toContain('.p-4');
    expect(css).not.toMatch(/box-sizing|:root|:host|--color-amber-300:/);
  });

  it('a warm rebuild writes new names; the previous build stays, older ones go', async () => {
    const dir = await appPackage();
    const builder = await appBuilder(dir);
    const names = [];
    for (const v of ['v1', 'v2', 'v3']) {
      await writeFile(join(dir, 'src/app/index.tsx'), APP.replace('v1', v));
      names.push((await builder.rebuild()).entry);
    }
    await builder.dispose();
    expect(new Set(names).size).toBe(3);
    const left = (await readdir(join(dir, 'dist/app'))).filter((n) => n.endsWith('.js'));
    expect(left.sort()).toEqual(['index.js', names[1], names[2]].sort());
  });

  it('refuses a package with no src/app entry; a syntax error rejects', async () => {
    const empty = await tempPackage({ 'package.json': json(PKG) });
    await expect(buildApp(empty)).rejects.toThrow('src/app/index.tsx not found');
    await expect(buildApp(await appPackage('export default (<'))).rejects.toThrow();
  });
});

describe('check of the app part', () => {
  const rules = { rules: RULES.filter((r) => ['entries', 'sealing'].includes(r.name)) };

  it('an app not built is a problem; fetch( in src/app is a warning', async () => {
    const dir = await appPackage(`${APP}export const x = () => fetch('/api/fixture/x');\n`);
    await mkdir(join(dir, 'dist'));
    const report = await check(dir, rules);
    expect(report.problems).toContainEqual(expect.objectContaining({ rule: 'entries' }));
    expect(report.problems.map((p) => p.problem).join()).toContain('dist/app/index.js not found');
    expect(report.warnings).toEqual([
      {
        rule: 'sealing',
        file: 'src/app/index.tsx',
        line: 10,
        problem: 'calls fetch(: an app uses useAppHost().api',
      },
    ]);
  });

  it('src/app imports only its own folder and src/lib', async () => {
    const dir = await appPackage(`import '../api/index.js';\n${APP}`);
    const report = await check(dir, { rules: RULES.filter((r) => r.name === 'sealing') });
    expect(report.problems.map((p) => p.problem)).toEqual([
      'imports ../api/index.js: a part imports only its own folder and src/lib',
    ]);
  });
});

describe('the build tools (S1.2.2 row 7)', () => {
  it('a missing tool stops the build with one error naming every missing one', () => {
    const find = (_dir: string, name: string) => (name === 'esbuild' ? 'x' : undefined);
    expect(() => requireBuildDeps('/d', find)).toThrow(
      'the app build needs postcss, @tailwindcss/postcss, tailwindcss: npm install --save-dev postcss @tailwindcss/postcss tailwindcss'
    );
    expect(() => requireBuildDeps('/d', () => 'x')).not.toThrow();
  });
});
