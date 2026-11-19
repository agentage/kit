import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertReach } from './seal-reach.js';

const CFG = '/home/u/.agentage';
const EXT = `${CFG}/extensions`;
const writes = [`${CFG}/run/probe`, `${CFG}/data/probe`];
const reach =
  (grant: string, id = 'probe') =>
  () =>
    assertReach([grant], writes, CFG, id);

describe('the trees a sealed child may read inside the config dir (C2)', () => {
  it.each([
    ['the 0.51 shared tree', `${EXT}/trees/abc123`],
    ['a package in the 0.51 tree', `${EXT}/trees/abc123/node_modules/@agentage/extension-probe`],
    ['its own version tree (market install)', `${EXT}/packages/trees/probe@0.7.0`],
    ['its own node_modules', `${EXT}/packages/trees/probe@0.7.0/node_modules`],
  ])('%s is granted', (_name, grant) => expect(reach(grant)).not.toThrow());

  it.each([
    ['the config dir itself', CFG],
    ['the extensions folder', EXT],
    ['the packages folder', `${EXT}/packages`],
    ['the version trees folder', `${EXT}/packages/trees`],
    ['the 0.51 trees folder', `${EXT}/trees`],
    ['a staging tree', `${EXT}/trees/.staging-x1`],
    ['the tree of another extension', `${EXT}/packages/trees/spy@1.0.0`],
    ['a tree of an id that starts the same', `${EXT}/packages/trees/probe-two@1.0.0`],
    ['a tree with no version', `${EXT}/packages/trees/probe@`],
    ['secrets.json', `${CFG}/secrets.json`],
    ['settings.json', `${CFG}/settings.json`],
    ['installation.json', `${CFG}/installation.json`],
    ['daemon.json', `${CFG}/daemon.json`],
    ['the data folder of another id', `${CFG}/data/other`],
    ['the run folder of another id', `${CFG}/run/other`],
  ])('%s is refused', (_name, grant) =>
    expect(reach(grant)).toThrow(
      `seal: the folder ${grant} would expose the agentage config folder`
    )
  );

  it('a version tree is granted only to its own id', () => {
    expect(reach(`${EXT}/packages/trees/spy@1.0.0`, 'spy')).not.toThrow();
  });

  it.each([
    ['a version with +build', `${EXT}/packages/trees/probe@0.7.0+build.5`, false],
    ['a trailing slash on its own tree', `${EXT}/packages/trees/probe@0.7.0/`, false],
    ['a trailing slash on the trees folder', `${EXT}/packages/trees/`, true],
  ])('%s', (_name, grant, refusedGrant) => {
    const run = expect(reach(grant));
    if (refusedGrant) run.toThrow('would expose the agentage config folder');
    else run.not.toThrow();
  });
});

describe('a symlinked tree folder is judged by its real path', () => {
  const setup = () => {
    const cfg = mkdtempSync(join(tmpdir(), 'seal-reach-'));
    const trees = join(cfg, 'extensions', 'packages', 'trees');
    mkdirSync(join(trees, 'spy@1.0.0'), { recursive: true });
    mkdirSync(join(cfg, 'data'), { recursive: true });
    return { cfg, trees };
  };

  it.each([
    ['the config folder', (cfg: string) => cfg],
    [
      'the tree of another id',
      (cfg: string) => join(cfg, 'extensions', 'packages', 'trees', 'spy@1.0.0'),
    ],
  ])('probe@x pointing at %s is refused', (_name, target) => {
    const { cfg, trees } = setup();
    const link = join(trees, 'probe@0.7.0');
    symlinkSync(target(cfg), link);
    expect(() => assertReach([link], [], cfg, 'probe')).toThrow(
      'would expose the agentage config folder'
    );
  });
});
