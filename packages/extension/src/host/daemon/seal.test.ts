import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test-support/packages.js';
import { homedir } from 'node:os';
import { kitReadDirs, permissionFlag, sealFlags, sealOf, sealOffReason, treeOf } from './seal.js';

describe('the Node floor of the seal (C2)', () => {
  it.each([
    ['20.19.0', 'off'],
    ['22.12.0', 'off'],
    ['22.13.0', 'off'],
    ['22.22.1', 'off'],
    ['22.22.2', 'on'],
    ['22.23.2', 'on'],
    ['23.0.0', 'off'],
    ['23.11.0', 'off'],
    ['24.6.0', 'off'],
    ['24.14.0', 'off'],
    ['24.14.1', 'on'],
    ['24.22.1', 'on'],
    ['25.0.0', 'off'],
    ['25.9.0', 'off'],
    ['26.0.0', 'on'],
    ['26.12.1', 'on'],
    ['27.1.0', 'off'],
  ])('Node %s: seal %s', (version, seal) => expect(sealOf(version)).toBe(seal));

  it.each([
    ['20.19.0', false],
    ['22.12.0', false],
    ['22.13.0', true],
    ['23.4.0', false],
    ['23.5.0', true],
    ['24.0.0', true],
    ['24.6.0', true],
    ['26.0.0', true],
  ])('Node %s: --permission flag %s', (version, flag) =>
    expect(permissionFlag(version)).toBe(flag)
  );

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
    const tree = `${CFG}/extensions/trees/abc123`;
    const dir = `${tree}/node_modules/@agentage/extension-probe`;
    expect(sealFlags({ main: KIT, dir, runDir: RUN, dataDir: DATA, configDir: CFG })).toEqual([
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
    const flags = sealFlags({
      main: KIT,
      dir: '/work/probe',
      runDir: RUN,
      dataDir: DATA,
      configDir: CFG,
    });
    expect(flags).toContain('--allow-fs-read=/work/probe');
    expect(flags.filter((f) => f.startsWith('--allow-fs-read'))).toHaveLength(4);
  });

  it('never a child process, worker, addon or WASI grant', () => {
    const flags = sealFlags({
      main: KIT,
      dir: '/work/probe',
      runDir: RUN,
      dataDir: DATA,
      configDir: CFG,
    });
    expect(flags.filter((f) => /child-process|worker|addons|wasi/.test(f))).toEqual([]);
  });

  it('a folder row behind a symlink: the link and the real folder are granted', async () => {
    const dir = await tempDir('agentage-seal-');
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'link'));
    const flags = sealFlags({
      main: KIT,
      dir: join(dir, 'link'),
      runDir: RUN,
      dataDir: DATA,
      configDir: CFG,
    });
    expect(flags).toContain(`--allow-fs-read=${await realpath(join(dir, 'real'))}`);
    expect(flags).toContain(`--allow-fs-read=${join(dir, 'link')}`);
  });

  it('treeOf: the folder above the last node_modules, else the path', () => {
    expect(treeOf('/t/x@1/node_modules/@a/b')).toBe('/t/x@1');
    expect(treeOf('/work/probe')).toBe('/work/probe');
  });

  it('a kit checkout: its package and the workspace root, nothing above it', async () => {
    const top = await tempDir('agentage-seal-');
    const repo = join(top, 'repo');
    const kit = join(repo, 'packages', 'kit');
    await mkdir(join(kit, 'dist', 'host'), { recursive: true });
    await mkdir(join(top, 'node_modules'));
    await writeFile(join(top, 'package.json'), '{"workspaces":["x"]}');
    await writeFile(join(repo, 'package.json'), '{"workspaces":["packages/*"]}');
    await writeFile(join(kit, 'package.json'), '{}');
    expect(kitReadDirs(join(kit, 'dist', 'host', 'main.js'))).toEqual([kit, repo]);
  });

  it('a kit package with no workspace root above it: the package alone', async () => {
    const kit = await tempDir('agentage-seal-');
    await writeFile(join(kit, 'package.json'), '{}');
    expect(kitReadDirs(join(kit, 'main.js'))).toEqual([kit]);
  });

  it('a workspace root above the home folder is never searched', () => {
    const above = join(homedir(), '..');
    expect(kitReadDirs(join(homedir(), 'nopkg-agentage', 'main.js'))).not.toContain(above);
  });

  it('a script with no package above it: its own folder', async () => {
    const dir = await tempDir('agentage-seal-');
    expect(kitReadDirs(join(dir, 'main.mjs'))[0]).toBe(dir);
  });
});

const at = (dir: string, configDir = CFG) =>
  sealFlags({
    main: KIT,
    dir,
    runDir: `${configDir}/run/x`,
    dataDir: `${configDir}/data/x`,
    configDir,
  });

describe('the seal never grants the config dir (C2)', () => {
  it.each([
    ['the config dir itself', CFG],
    ['a folder above it (home)', '/home/u'],
    ['a tree that is an ancestor', '/home/u/node_modules/@x/ext'],
    ['a folder inside it that is no cli tree', `${CFG}/extensions/current`],
    ['the run folder of another id', `${CFG}/run/other`],
  ])('%s is refused', (_name, dir) => {
    expect(() => at(dir)).toThrow(
      `seal: the folder ${treeOf(dir)} would expose the agentage config folder`
    );
  });

  it('a cli tree inside the config dir is granted', () => {
    expect(at(`${CFG}/extensions/trees/abc/node_modules/x`)).toContain(
      `--allow-fs-read=${CFG}/extensions/trees/abc`
    );
  });

  it('a config dir behind a symlink: the real path is compared too', async () => {
    const top = await realpath(await tempDir('agentage-seal-'));
    await mkdir(join(top, 'real'));
    await symlink(join(top, 'real'), join(top, 'cfg'));
    expect(() => at(join(top, 'real'), join(top, 'cfg'))).toThrow('would expose');
  });

  it.each([
    ['ends in *', '/work/ext*'],
    ['has a * inside', '/work/*/ext'],
  ])('a folder that %s is refused', (_name, dir) => {
    expect(() => at(dir)).toThrow(`seal: the folder ${dir} has a * that Node reads as a wildcard`);
  });

  it('a config dir with a * is refused (its run and data grants)', () => {
    expect(() => at('/work/ext', '/home/u/.agent*age')).toThrow('has a * that Node reads');
  });
});
