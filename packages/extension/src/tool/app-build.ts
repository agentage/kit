import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type * as Esbuild from 'esbuild';
import { APP_DIR, APP_META_FILE } from '../manifest/parts.js';
import { exists } from './stage.js';
import { loadFrom, packageDir, requireBuildDeps, resolveFrom } from './app-load.js';

// K4: one React and one @agentage/extension/app for the shell and every app, given by the import map.
export const APP_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@agentage/extension/app',
] as const;

export interface AppFiles {
  entry: string;
  css: string;
}

export interface AppBuilder {
  rebuild(): Promise<AppFiles>;
  dispose(): Promise<void>;
}

const SOURCES = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];

const sourceOf = async (dir: string): Promise<string> => {
  for (const name of SOURCES) {
    const file = join(dir, 'src', 'app', name);
    if (await exists(file)) return file;
  }
  throw new Error('src/app/index.tsx not found: the app part is one root component there');
};

const esbuildOptions = (dir: string, entry: string): Esbuild.BuildOptions => ({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
  absWorkingDir: dir,
  external: [...APP_EXTERNALS],
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  metafile: true,
  outfile: join(dir, APP_DIR, 'app.js'),
});

const LIB = /(^|\/)node_modules\/@agentage\/components\//;

// The components files the app bundles: their classes are scanned too, or a Button has no style.
export const libSources = (dir: string, metafile?: Esbuild.Metafile): string[] =>
  Object.keys(metafile?.inputs ?? {})
    .filter((file) => LIB.test(file))
    .map((file) => resolve(dir, file));

// The components tokens as reference: names, @utility and keyframes; the shell gives the values.
const libTokens = (dir: string): string[] => {
  const file = resolveFrom(dir, '@agentage/components/styles/tokens.css');
  return file ? [`@import "${file}" reference;`] : [];
};

// Utilities only, no preflight and no theme variables: the shell owns both.
// Token names only (reference): utilities like bg-primary exist; the shell gives the values.
const cssInput = (dir: string, extra: string[]): string => {
  const tw = packageDir(dir, 'tailwindcss');
  const tokens = resolveFrom(dir, '@agentage/extension/app/theme.css');
  return [
    '@layer theme, utilities;',
    `@import "${join(tw, 'theme.css')}" layer(theme) theme(reference inline);`,
    ...libTokens(dir),
    ...(tokens ? [`@import "${tokens}" layer(theme) theme(reference);`] : []),
    `@import "${join(tw, 'utilities.css')}" layer(utilities) source(none);`,
    `@source "${join(dir, 'src', 'app')}";`,
    ...extra.map((file) => `@source "${file}";`),
  ].join('\n');
};

type Postcss = (plugins: unknown[]) => {
  process(css: string, opts: { from: string }): Promise<{ css: string }>;
};

const compileCss = async (dir: string, extra: string[]): Promise<string> => {
  const postcss = await loadFrom<Postcss>(dir, 'postcss');
  const tailwind = await loadFrom<(o: object) => unknown>(dir, '@tailwindcss/postcss');
  const plugin = tailwind({ base: dir, optimize: { minify: true } });
  const from = join(dir, 'src', 'app', 'app.css');
  return (await postcss([plugin]).process(cssInput(dir, extra), { from })).css;
};

const hashed = (code: Uint8Array | string, ext: string) =>
  `app-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.${ext}`;

// Written then renamed: a reader sees the old file or the new one, never half of one.
const writeAtomic = async (file: string, text: string) => {
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
};

const previous = async (out: string): Promise<string[]> => {
  const text = await readFile(join(out, APP_META_FILE), 'utf8').catch(() => '{}');
  const meta = JSON.parse(text) as Partial<AppFiles>;
  return [meta.entry, meta.css].filter((name): name is string => typeof name === 'string');
};

// The current and the previous build stay: an open page may still import the previous one.
const prune = async (out: string, keep: string[]) => {
  const old = (await readdir(out)).filter((name) => /^app-.+\.(js|css)$/.test(name));
  await Promise.all(old.filter((n) => !keep.includes(n)).map((n) => rm(join(out, n))));
};

const writeApp = async (dir: string, code: Uint8Array, css: string): Promise<AppFiles> => {
  const out = join(dir, APP_DIR);
  await mkdir(out, { recursive: true });
  const files = { entry: hashed(code, 'js'), css: hashed(css, 'css') };
  const kept = await previous(out);
  await writeFile(join(out, files.entry), code);
  await writeFile(join(out, files.css), css);
  await writeAtomic(join(out, 'index.js'), `export { default } from './${files.entry}';\n`);
  await writeAtomic(join(out, APP_META_FILE), `${JSON.stringify(files)}\n`);
  await prune(out, [...kept, files.entry, files.css]);
  return files;
};

// A warm esbuild context: `up` calls rebuild() on each save; dispose() when it stops.
export const appBuilder = async (at: string): Promise<AppBuilder> => {
  const dir = resolve(at);
  requireBuildDeps(dir);
  const esbuild = await loadFrom<typeof Esbuild>(dir, 'esbuild');
  const ctx = await esbuild.context(esbuildOptions(dir, await sourceOf(dir)));
  const rebuild = async () => {
    const result = await ctx.rebuild();
    const code = result.outputFiles?.[0]?.contents ?? new Uint8Array();
    return writeApp(dir, code, await compileCss(dir, libSources(dir, result.metafile)));
  };
  return { rebuild, dispose: () => ctx.dispose() };
};

// dist/app: app-<hash>.js and .css (immutable), index.js and app.json (no-cache) naming them.
export const buildApp = async (dir: string): Promise<AppFiles> => {
  const builder = await appBuilder(dir);
  try {
    return await builder.rebuild();
  } finally {
    await builder.dispose();
  }
};
