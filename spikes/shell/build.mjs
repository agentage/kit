// Spike build: one vendor set (React, react-dom, @agentage/app) with shared chunks, the shell, and apps built apart.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build, context } from 'esbuild';

const here = new URL('.', import.meta.url).pathname;
export const out = join(here, 'out');
const require = createRequire(import.meta.url);
export const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@agentage/app',
];

const base = {
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const reexport = (spec, names, def) =>
  `import M from '${spec}';\n${def ? 'export default M;\n' : ''}export const { ${names.join(', ')} } = M;\n`;

const vendorEntries = async () => {
  const dir = join(here, '.vendor');
  await mkdir(dir, { recursive: true });
  const files = {
    react: reexport('react', Object.keys(require('react')), true),
    'jsx-runtime': reexport('react/jsx-runtime', ['jsx', 'jsxs', 'Fragment']),
    'react-dom': reexport('react-dom', Object.keys(require('react-dom')), true),
    'react-dom-client': reexport('react-dom/client', ['createRoot', 'hydrateRoot', 'version']),
  };
  for (const [n, c] of Object.entries(files)) await writeFile(join(dir, `${n}.js`), c);
  return {
    ...Object.fromEntries(Object.keys(files).map((n) => [n, join(dir, `${n}.js`)])),
    app: join(here, 'src/app/index.tsx'),
  };
};

// One build with splitting, so react-dom and @agentage/app import the same React chunk.
export const buildVendor = async () => {
  const entryPoints = await vendorEntries();
  const appExternal = {
    name: 'self',
    setup: (b) =>
      b.onResolve({ filter: /^@agentage\/app$/ }, () => ({ path: './app.js', external: true })),
  };
  await build({
    ...base,
    entryPoints,
    splitting: true,
    outdir: join(out, 'shell/vendor'),
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
    plugins: [appExternal],
  });
};

export const buildShell = async () => {
  await build({
    ...base,
    entryPoints: [join(here, 'src/shell/main.tsx')],
    outfile: join(out, 'shell/shell.js'),
    external: EXTERNALS,
  });
  await writeFile(join(out, 'shell/frame.css'), await readFile(join(here, 'src/shell/frame.css')));
};

// Warm context per app; each rebuild writes app-<hash>.js (immutable) and index.js (no-cache) pointing at it.
export const appContext = async (id, { externals = true } = {}) => {
  const ctx = await context({
    ...base,
    entryPoints: [join(here, `apps/${id}/index.tsx`)],
    write: false,
    outfile: 'x.js',
    external: externals ? EXTERNALS : [],
  });
  const dir = join(out, 'app', id);
  const rebuild = async () => {
    const res = await ctx.rebuild();
    const code = res.outputFiles[0].contents;
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `app-${hash}.js`), code);
    await writeFile(join(dir, 'index.js'), `export { default } from './app-${hash}.js';\n`);
    return { entry: `/app/${id}/app-${hash}.js`, bytes: code.length };
  };
  return { rebuild, dispose: () => ctx.dispose() };
};

export const clean = () => rm(out, { recursive: true, force: true });
