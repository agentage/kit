// Builds dist/: index.html, shell.js, shell.css, vendor/* (one React for shell and apps).
// The daemon serves dist/index.html at / and dist/* at /shell/*: SHELL_URL is that one mapping.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import postcss from 'postcss';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(pkgDir, 'package.json'));
const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));

// What the import map serves; apps and the shell keep these external (K4).
export const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@agentage/extension/app',
];
export const SHELL_URL = '/shell/';
// `/shell/vendor/react.js` -> `vendor/react.js` in dist/; null for any other path.
export const shellFileOf = (path) =>
  path.startsWith(SHELL_URL) ? path.slice(SHELL_URL.length) : null;

const DS_USED = ['command', 'dropdown-menu', 'empty-state', 'icon-button', 'kbd', 'resizable'];

const base = {
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const reexport = (spec, names, withDefault) =>
  `import M from '${spec}';\n${withDefault ? 'export default M;\n' : ''}export const { ${names.join(', ')} } = M;\n`;

// One build with splitting, so react-dom and the app kit import the same React chunk.
const buildVendor = async (out, tmp) => {
  await mkdir(tmp, { recursive: true });
  const files = {
    react: reexport('react', Object.keys(require('react')), true),
    'jsx-runtime': reexport('react/jsx-runtime', ['jsx', 'jsxs', 'Fragment']),
    'react-dom': reexport('react-dom', Object.keys(require('react-dom')), true),
    'react-dom-client': reexport('react-dom/client', ['createRoot', 'hydrateRoot', 'version']),
    app: "export * from '@agentage/app';\n",
  };
  for (const [name, code] of Object.entries(files)) await writeFile(join(tmp, `${name}.js`), code);
  await build({
    ...base,
    entryPoints: Object.fromEntries(Object.keys(files).map((n) => [n, join(tmp, `${n}.js`)])),
    nodePaths: [join(pkgDir, 'node_modules'), join(pkgDir, '../../node_modules')],
    splitting: true,
    outdir: join(out, 'vendor'),
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
  });
};

const dsSources = () => {
  const dir = dirname(
    fileURLToPath(
      import.meta.resolve('@agentage/design-system/kbd', pathToFileURL(pkgDir + '/').href)
    )
  );
  return DS_USED.map(
    (f) => `@source "${join(dir, `${f}*.js`)}";\n@source "${join(dir, 'menu*.js')}";`
  ).join('\n');
};

export const buildCss = async (out) => {
  const from = join(pkgDir, 'src/styles/shell.css');
  const source = `${await readFile(from, 'utf8')}\n${dsSources()}\n`;
  const res = await postcss([tailwind({ base: pkgDir, optimize: { minify: true } })]).process(
    source,
    { from }
  );
  await writeFile(join(out, 'shell.css'), res.css);
};

// The shell source imports the private workspace @agentage/app: the import map names it as apps do.
export const appAsKit = {
  name: 'app-as-kit',
  setup: (b) =>
    b.onResolve({ filter: /^@agentage\/app$/ }, () => ({
      path: '@agentage/extension/app',
      external: true,
    })),
};

export const buildShell = async ({
  out,
  entry = 'src/main.tsx',
  name = 'shell.js',
  html = 'index.html',
}) => {
  await build({
    ...base,
    entryPoints: [join(pkgDir, entry)],
    outfile: join(out, name),
    external: EXTERNALS,
    plugins: [appAsKit],
  });
  const { SPLIT_PREPAINT } = await import('@agentage/app');
  const page = (await readFile(join(pkgDir, 'src/index.html'), 'utf8'))
    .replace('%VERSION%', pkg.version)
    .replace('%SPLIT_PREPAINT%', SPLIT_PREPAINT)
    .replace('%ENTRY%', name);
  await writeFile(join(out, html), page);
};

export const buildAll = async (out = join(pkgDir, 'dist')) => {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await buildVendor(out, join(pkgDir, '.vendor'));
  await buildShell({ out });
  await buildCss(out);
  return out;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildAll();
  console.log(`shell-dashboard  ${out}`);
}
