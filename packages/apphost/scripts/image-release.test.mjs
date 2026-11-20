import { describe, expect, it } from 'vitest';
import {
  facts,
  imageDecision,
  imageRecord,
  main,
  registryDigest,
  releaseAssets,
  tagCommit,
} from './image-release.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const D1 = `sha256:${'1'.repeat(64)}`;
const D2 = `sha256:${'2'.repeat(64)}`;
const apphost = {
  name: '@agentage/apphost',
  version: '0.2.3',
  dependencies: { '@agentage/shell-dashboard': '0.3.1', zod: '^4.2.0' },
};
const kit = { version: '0.20.4' };

describe('imageRecord', () => {
  it('has the exact form of the release record', () => {
    expect(imageRecord({ apphost, kit, commit: A, digest: D1 })).toEqual({
      package: '@agentage/apphost',
      version: '0.2.3',
      commit: A,
      image: `ghcr.io/agentage/platform/apphost:0.2.3@${D1}`,
      shell: { package: '@agentage/shell-dashboard', version: '0.3.1' },
      kit: '0.20.4',
    });
  });

  it('refuses a shell range, a missing shell, a short commit and a bad digest', () => {
    const ranged = { ...apphost, dependencies: { '@agentage/shell-dashboard': '^0.3.1' } };
    expect(() => imageRecord({ apphost: ranged, kit, commit: A, digest: D1 })).toThrow(/exact/);
    const none = { ...apphost, dependencies: {} };
    expect(() => imageRecord({ apphost: none, kit, commit: A, digest: D1 })).toThrow(/exact/);
    expect(() => imageRecord({ apphost, kit, commit: 'abc', digest: D1 })).toThrow(/40 hex/);
    expect(() => imageRecord({ apphost, kit, commit: A, digest: 'sha256:1' })).toThrow(/digest/);
    expect(() => imageRecord({ apphost, kit: {}, commit: A, digest: D1 })).toThrow(/kit/);
    const v = { ...apphost, version: 'x' };
    expect(() => imageRecord({ apphost: v, kit, commit: A, digest: D1 })).toThrow(/apphost/);
  });
});

describe('imageDecision', () => {
  const base = {
    hasAsset: false,
    releaseCommit: '',
    commit: A,
    versionDigest: '',
    commitDigest: '',
  };
  it('skips when the record is on the release', () => {
    expect(imageDecision({ ...base, hasAsset: true, versionDigest: D1 }).action).toBe('skip');
  });
  it('skips a version released at another commit', () => {
    expect(imageDecision({ ...base, releaseCommit: B }).action).toBe('skip');
  });
  it('builds when no tag exists, with or without the release of this commit', () => {
    expect(imageDecision(base).action).toBe('build');
    expect(imageDecision({ ...base, releaseCommit: A }).action).toBe('build');
  });
  it('records the pushed digest on a re-run of the same commit', () => {
    const d = imageDecision({ ...base, versionDigest: D1, commitDigest: D1 });
    expect(d).toMatchObject({ action: 'record', digest: D1 });
  });
  it('refuses a tag with another digest', () => {
    expect(imageDecision({ ...base, versionDigest: D1, commitDigest: D2 }).action).toBe('refuse');
    expect(imageDecision({ ...base, versionDigest: D1 }).action).toBe('refuse');
  });
});

// A fake command runner: one answer per command name.
const runner = (answers) => (cmd, args) => {
  const a = answers[cmd];
  return typeof a === 'function' ? a(args) : a;
};
const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
const err = (stderr) => ({ status: 1, stdout: '', stderr });

describe('probes', () => {
  it('reads a digest, and a clean "not found" as absent', () => {
    expect(registryDigest(runner({ docker: ok(`{"digest":"${D1}"}`) }), 'x:1')).toBe(D1);
    const missing = err('ERROR: ghcr.io/agentage/platform/apphost:0.2.3: not found');
    expect(registryDigest(runner({ docker: missing }), 'x:1')).toBe('');
    expect(registryDigest(runner({ docker: err('MANIFEST_UNKNOWN: manifest unknown') }), 'x')).toBe(
      ''
    );
  });
  it('throws on a registry outage or a refusal: never "absent"', () => {
    const denied = err('failed to authorize: 403 Forbidden');
    expect(() => registryDigest(runner({ docker: denied }), 'x:1')).toThrow(/403/);
    const gone = { status: null, stdout: undefined, stderr: undefined };
    expect(() => registryDigest(runner({ docker: gone }), 'x:1')).toThrow(/failed/);
  });
  it('reads release assets; "release not found" is absent, another error throws', () => {
    const assets = ok('{"assets":[{"name":"agentage-apphost.json"}]}');
    expect(releaseAssets(runner({ gh: assets }), 't')).toEqual(['agentage-apphost.json']);
    expect(releaseAssets(runner({ gh: err('release not found') }), 't')).toBe('');
    expect(() => releaseAssets(runner({ gh: err('HTTP 502') }), 't')).toThrow(/502/);
  });
  it('reads the tag commit, peeled when annotated; no tag is absent; a git error throws', () => {
    const light = ok(`${A}\trefs/tags/@agentage/apphost@0.2.3\n`);
    expect(tagCommit(runner({ git: light }), 't')).toBe(A);
    const annotated = ok(`${B}\trefs/tags/t\n${A}\trefs/tags/t^{}\n`);
    expect(tagCommit(runner({ git: annotated }), 't')).toBe(A);
    expect(tagCommit(runner({ git: ok('') }), 't')).toBe('');
    expect(() => tagCommit(runner({ git: err('') }), 't')).toThrow(/git/);
  });
});

describe('facts and main', () => {
  const run = runner({
    gh: err('release not found'),
    git: ok(''),
    docker: (args) => (args[3].endsWith(A) ? err(': not found') : ok(`{"digest":"${D1}"}`)),
  });
  it('gathers the facts of one version', () => {
    expect(facts(run, { version: '0.2.3', commit: A })).toEqual({
      hasAsset: false,
      releaseCommit: '',
      commit: A,
      versionDigest: D1,
      commitDigest: '',
    });
  });
  it('a skip makes no registry call, so a registry it cannot read does not turn it red', () => {
    const denied = () => {
      throw new Error('registry read');
    };
    const asset = ok('{"assets":[{"name":"agentage-apphost.json"}]}');
    const done = runner({ gh: asset, git: ok(''), docker: denied });
    expect(imageDecision(facts(done, { version: '0.2.3', commit: A })).action).toBe('skip');
    const old = runner({ gh: ok('{"assets":[]}'), git: ok(`${B}\tt\n`), docker: denied });
    expect(imageDecision(facts(old, { version: '0.2.2', commit: A })).action).toBe('skip');
  });
  it('decide prints the output lines; record prints the record of this tree', () => {
    const decided = main(['decide'], { root: '.', commit: A, run });
    expect(decided).toMatch(/^version=\d+\.\d+\.\d+\naction=refuse\ndigest=\nreason=tag has /);
    const record = JSON.parse(main(['record', D1], { root: '.', commit: A, run }));
    expect(record).toMatchObject({
      package: '@agentage/apphost',
      commit: A,
      kit: expect.any(String),
    });
    expect(() => main(['push'], { root: '.', commit: A, run })).toThrow(/usage/);
  });
});
