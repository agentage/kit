import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, sep } from 'node:path';
import { type ExtensionPackage, hasStore } from '@agentage/extension/internal';
import { assertReach, real } from './seal-reach.js';

// partial: on, with the child-process grant of a git store (PD2): git itself runs outside the seal.
export type Seal = 'on' | 'off' | 'partial';

// G6 (PD2): a git store spawns git for each operation; no other package gets a child process.
export const spawnsGit = (pkg: ExtensionPackage): boolean => hasStore(pkg, 'git');

export const sealOfEntry = (seal: Seal, pkg: ExtensionPackage | undefined): Seal =>
  seal === 'on' && pkg && spawnsGit(pkg) ? 'partial' : seal;

// C2: the permission model with the bypass fixes of D2; the same rule as e2e sealFloorMet.
const SEAL_FLOOR = 'Node 22.22.2 or 24.14.1';

const versionOf = (version: string) => version.split('.').map(Number) as [number, number, number];

const atLeast = (version: string, major: number, minor: number, patch: number) => {
  const [a = 0, b = 0, c = 0] = versionOf(version);
  return a === major && (b > minor || (b === minor && c >= patch));
};

// An odd major has no known fix release: off; an even major above 24 is on.
export const sealOf = (version: string): Seal => {
  const [major = 0] = versionOf(version);
  if (major === 22) return atLeast(version, 22, 22, 2) ? 'on' : 'off';
  if (major === 24) return atLeast(version, 24, 14, 1) ? 'on' : 'off';
  return major > 24 && major % 2 === 0 ? 'on' : 'off';
};

// --permission is a stable flag from 22.13.0 and 23.5.0: below the floor it still limits, seal off.
export const permissionFlag = (version: string): boolean => {
  const [major = 0] = versionOf(version);
  return major >= 24 || atLeast(version, 22, 13, 0) || atLeast(version, 23, 5, 0);
};

export const sealOffReason = (version: string): string =>
  `seal off: ${SEAL_FLOOR} needed, this is Node ${version}`;

const NODE_MODULES = `${sep}node_modules${sep}`;

// The folder that holds the node_modules a path sits in (a tree of the cli); else the path itself.
export const treeOf = (dir: string): string => {
  const at = dir.lastIndexOf(NODE_MODULES);
  return at < 0 ? dir : dir.slice(0, at);
};

const hasWorkspaces = (dir: string): boolean => {
  try {
    return 'workspaces' in (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as object);
  } catch {
    return false;
  }
};

// The folders from start up, never above the user's home nor the root.
const upward = (start: string): string[] => {
  const found = [start];
  for (let dir = start; dir !== homedir() && dir !== parse(dir).root;)
    found.push((dir = dirname(dir)));
  return found;
};

// The nearest folder with a package.json; none: the folder of the file.
const packageRoot = (file: string): string =>
  upward(dirname(file)).find((dir) => existsSync(join(dir, 'package.json'))) ?? dirname(file);

const kitDeps = (pkgDir: string): string[] => {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      dependencies?: object;
      peerDependencies?: object;
    };
    return Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
  } catch {
    return [];
  }
};

// Node walks out of a kit nested under the cli to the node_modules npm hoisted a dependency to.
const hoistedDirs = (inner: string, main: string): string[] => {
  const walk = upward(dirname(inner)).map((dir) => join(dir, 'node_modules'));
  const found = kitDeps(packageRoot(main)).map((dep) =>
    walk.find((dir) => existsSync(join(dir, dep, 'package.json')))
  );
  return [...new Set([inner, ...found.filter((dir) => dir !== undefined)])];
};

// Installed: the node_modules of the kit and its dependencies. A checkout: its package and workspace root.
export const kitReadDirs = (main: string): string[] => {
  const at = main.lastIndexOf(NODE_MODULES);
  if (at >= 0) return hoistedDirs(main.slice(0, at + NODE_MODULES.length - 1), main);
  const root = packageRoot(main);
  return [...new Set([root, upward(root).find(hasWorkspaces) ?? root])];
};

interface SealAt {
  id: string;
  main: string;
  dir: string;
  configDir: string;
  runDir: string;
  dataDir: string;
  childProcess?: boolean;
}

// C2: read kit, tree, run/{id}, data/{id}; write the last two; no worker, addon, WASI, sqlite; a child process for git only.
export const sealFlags = (at: SealAt): string[] => {
  const { id, main, dir, configDir, runDir, dataDir } = at;
  const both = (paths: string[]) => [...new Set(paths.flatMap((path) => [path, real(path)]))];
  const writes = both([runDir, dataDir]);
  const kit = both([...kitReadDirs(main), treeOf(dir)]);
  assertReach(kit, writes, configDir, id);
  const reads = [...new Set([...kit, ...writes])];
  return [
    '--permission',
    '--no-experimental-sqlite',
    ...(at.childProcess ? ['--allow-child-process'] : []),
    ...reads.map((path) => `--allow-fs-read=${path}`),
    ...writes.map((path) => `--allow-fs-write=${path}`),
  ];
};
