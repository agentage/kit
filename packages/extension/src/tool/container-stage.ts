import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { OPENAPI_FILE } from '../discovery/openapi.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore, imageParts, migratesStore } from '../manifest/parts.js';
import { containerRecipe } from './container-recipe.js';
import { kitPgliteVersion } from './kit-version.js';
import { assertBuilt, copyDeps, exists } from './stage.js';

const PGLITE_KEY = 'node_modules/@electric-sql/pglite';

// An exact semver, nothing else: the value goes into a RUN line.
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// The PGlite the package tests with (its lock), else the exact copy the kit resolves; never a range.
export const pgliteVersion = async (dir: string, kitCopy = kitPgliteVersion): Promise<string> => {
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: unknown }>;
  };
  const version = lock.packages?.[PGLITE_KEY]?.version ?? kitCopy();
  if (version === undefined)
    throw new Error('no PGlite version: npm install -D @electric-sql/pglite in the package');
  if (typeof version !== 'string' || !EXACT_VERSION.test(version))
    throw new Error(`PGlite version is not an exact semver: ${JSON.stringify(version)}`);
  return version;
};

// Compiled tests, source maps and earlier build records (dist/agentage-*.json) never ship.
export const shippedFrom =
  (dir: string) =>
  (path: string): boolean => {
    const name = basename(path);
    const record = dirname(path) === join(dir, 'dist') && /^agentage-.*\.json$/.test(name);
    return !record && !/\.test\.|\.map$/.test(name);
  };

// The one image carries all of dist/, the OpenAPI file and the migrations; seeds never ship.
export const containerPaths = async (dir: string, pkg: ExtensionPackage): Promise<string[]> => {
  const paths = ['package.json', 'dist'];
  if (await exists(join(dir, OPENAPI_FILE))) paths.push(OPENAPI_FILE);
  if (migratesStore(pkg) && (await exists(join(dir, 'migrations')))) paths.push('migrations');
  return paths;
};

// A clean build context for the one image: deps/ (npm ci), app/ (the package) and the Dockerfile.
export const stageContainer = async (
  dir: string,
  pkg: ExtensionPackage,
  tmpRoot: string = tmpdir()
): Promise<string> => {
  for (const part of imageParts(pkg)) await assertBuilt(dir, pkg, part);
  const root = await mkdtemp(join(tmpRoot, `agentage-${pkg.agentage.id}-container-`));
  await copyDeps(dir, root, pkg);
  await mkdir(join(root, 'app'));
  const filter = shippedFrom(dir);
  for (const path of await containerPaths(dir, pkg))
    await cp(join(dir, path), join(root, 'app', path), { recursive: true, filter });
  const pglite = hasStore(pkg, 'postgres') ? await pgliteVersion(dir) : undefined;
  await writeFile(join(root, 'Dockerfile'), containerRecipe({ pglite }));
  return root;
};
