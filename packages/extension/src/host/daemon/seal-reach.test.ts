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
});
