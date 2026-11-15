import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENAPI_FILE } from '../discovery/openapi.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore, imageParts, migratesStore } from '../manifest/parts.js';
import { containerRecipe } from './container-recipe.js';
import { KIT_PGLITE_RANGE } from './kit-version.js';
import { assertBuilt, copyDeps, copyInto, exists } from './stage.js';

const PGLITE_KEY = 'node_modules/@electric-sql/pglite';

// The PGlite the package tests with (its lock), else the kit's peer range.
export const pgliteVersion = async (dir: string): Promise<string> => {
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string }>;
  };
  return lock.packages?.[PGLITE_KEY]?.version ?? KIT_PGLITE_RANGE;
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
  for (const path of await containerPaths(dir, pkg))
    await copyInto(join(dir, path), join(root, 'app', path));
  const pglite = hasStore(pkg, 'postgres') ? await pgliteVersion(dir) : undefined;
  await writeFile(join(root, 'Dockerfile'), containerRecipe({ pglite }));
  return root;
};
