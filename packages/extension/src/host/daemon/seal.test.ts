import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test-support/packages.js';
import { kitReadDirs, sealFlags, sealOf, sealOffReason, treeOf } from './seal.js';

describe('the Node floor of the seal (C2)', () => {
  it.each([
    ['20.19.0', 'off'],
    ['22.12.0', 'off'],
    ['22.13.0', 'off'],
    ['22.22.1', 'off'],
    ['22.22.2', 'on'],
    ['22.23.2', 'on'],
    ['23.11.0', 'off'],
    ['24.6.0', 'off'],
    ['24.14.0', 'off'],
    ['24.14.1', 'on'],
    ['24.22.1', 'on'],
    ['25.0.0', 'on'],
    ['26.12.1', 'on'],
  ])('Node %s: seal %s', (version, seal) => expect(sealOf(version)).toBe(seal));

  it('the reason names the floor and the Node that runs', () => {
    expect(sealOffReason('24.6.0')).toBe(
      'seal off: Node 22.22.2 or 24.14.1 needed, this is Node 24.6.0'
    );
  });
});

const CFG = '/home/u/.agentage';
const RUN = `${CFG}/run/probe`;
const DATA = `${CFG}/data/probe`;
const KIT =
  '/usr/lib/node_modules/@agentage/cli/node_modules/@agentage/extension/dist/host/main.js';

describe('the flags of a sealed child (C2)', () => {
  it('a tree row: the cli node_modules, the tree of that version, run and data; nothing else', () => {
    const tree = `${CFG}/extensions/packages/trees/probe@0.7.0`;
    const dir = `${tree}/node_modules/@agentage/extension-probe`;
    expect(sealFlags({ main: KIT, dir, runDir: RUN, dataDir: DATA })).toEqual([
      '--permission',
      '--no-experimental-sqlite',
      '--allow-fs-read=/usr/lib/node_modules/@agentage/cli/node_modules',
      `--allow-fs-read=${tree}`,
      `--allow-fs-read=${RUN}`,
      `--allow-fs-read=${DATA}`,
      `--allow-fs-write=${RUN}`,
      `--allow-fs-write=${DATA}`,
    ]);
  });

  it('a folder row: the folder itself', () => {
    const flags = sealFlags({ main: KIT, dir: '/work/probe', runDir: RUN, dataDir: DATA });
    expect(flags).toContain('--allow-fs-read=/work/probe');
    expect(flags.filter((f) => f.startsWith('--allow-fs-read'))).toHaveLength(4);
  });

  it('never a child process, worker, addon or WASI grant', () => {
    const flags = sealFlags({ main: KIT, dir: '/work/probe', runDir: RUN, dataDir: DATA });
    expect(flags.filter((f) => /child-process|worker|addons|wasi/.test(f))).toEqual([]);
  });

  it('a folder row behind a symlink: the link and the real folder are granted', async () => {
    const dir = await tempDir('agentage-seal-');
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'link'));
    const flags = sealFlags({ main: KIT, dir: join(dir, 'link'), runDir: RUN, dataDir: DATA });
    expect(flags).toContain(`--allow-fs-read=${await realpath(join(dir, 'real'))}`);
    expect(flags).toContain(`--allow-fs-read=${join(dir, 'link')}`);
  });

  it('treeOf: the folder above the last node_modules, else the path', () => {
    expect(treeOf('/t/x@1/node_modules/@a/b')).toBe('/t/x@1');
    expect(treeOf('/work/probe')).toBe('/work/probe');
  });

  it('a kit checkout (no node_modules above it): its package and each folder holding a node_modules', async () => {
    const repo = await tempDir('agentage-seal-');
    const kit = join(repo, 'packages', 'kit');
    await mkdir(join(kit, 'dist', 'host'), { recursive: true });
    await mkdir(join(repo, 'node_modules'));
    await writeFile(join(kit, 'package.json'), '{}');
    const dirs = kitReadDirs(join(kit, 'dist', 'host', 'main.js'));
    expect(dirs.slice(0, 2)).toEqual([kit, repo]);
  });

  it('a script with no package above it: its own folder', async () => {
    const dir = await tempDir('agentage-seal-');
    expect(kitReadDirs(join(dir, 'main.mjs'))[0]).toBe(dir);
  });
});
