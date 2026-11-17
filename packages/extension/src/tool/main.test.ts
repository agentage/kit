import { describe, expect, it } from 'vitest';
import { DIGEST, SHA } from '../test-support/packages.js';
import { type BuildOptions, type BuildResult } from './build.js';
import { buildLines } from './format.js';
import { main, type MainDeps } from './main.js';

const RESULT: BuildResult = {
  id: 'probe',
  version: '0.1.0',
  commit: SHA,
  buildTime: '2026-11-03T20:00:00Z',
  images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0' }],
};

const deps = (result: BuildResult | Error = RESULT) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: BuildOptions[] = [];
  const d: MainDeps = {
    build: async (options) => {
      calls.push(options);
      if (result instanceof Error) throw result;
      return result;
    },
    app: async (dir) => {
      calls.push({ dir });
      return { entry: 'app-1.js', css: 'app-2.css' };
    },
    up: async () => undefined,
    down: async () => undefined,
    token: async () => 'aga_x',
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
  };
  return { d, out, err, calls };
};

// A usage error runs nothing and prints the usage.
const usageOf = async (argv: string[]) => {
  const usage = deps();
  expect(await main(argv, usage.d)).toBe(2);
  expect(usage.calls).toEqual([]);
  return usage.err;
};

describe('tool cli', () => {
  it('build prints one line per image and exits 0', async () => {
    const { d, out, calls } = deps();
    expect(await main(['build', '--push', '--dir', 'x'], d)).toBe(0);
    expect(calls).toEqual([{ push: true, dir: 'x', registry: undefined }]);
    expect(out).toEqual(['api     ghcr.io/agentage/probe-api:0.1.0  built']);
  });

  it('app builds dist/app in --dir and prints the two hashed files', async () => {
    const { d, out, calls } = deps();
    expect(await main(['app', '--dir', 'x'], d)).toBe(0);
    expect([calls, out]).toEqual([
      [{ dir: 'x' }],
      ['app     dist/app/app-1.js dist/app/app-2.css'],
    ]);
  });

  it('build --container asks the kit for the one image', async () => {
    const { d, calls } = deps();
    expect(await main(['build', '--container'], d)).toBe(0);
    expect(calls).toEqual([{ container: true }]);
  });

  it('exits 1 when the build fails, 2 on usage, 0 on --help', async () => {
    const failing = deps(new Error('docker build failed'));
    expect(await main(['build'], failing.d)).toBe(1);
    expect(failing.err).toEqual(['build failed: docker build failed']);
    for (const argv of [[], ['deploy'], ['build', 'x']])
      expect(await usageOf(argv)).toEqual([expect.stringMatching(/^usage: agentage-extension </)]);
    expect(await usageOf(['build', '--nope'])).toEqual([
      expect.stringMatching(/^Unknown option '--nope'.*\nusage: agentage-extension </),
    ]);
    const help = deps();
    expect(await main(['--help'], help.d)).toBe(0);
    expect(help.out[0]).toMatch(/^usage: agentage-extension <build\|app\|up\|down\|token>/);
  });
});

describe('buildLines', () => {
  it('shows the short digest of a pushed image and the record path', () => {
    const pushed: BuildResult = {
      ...RESULT,
      images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0', digest: DIGEST }],
      recordFile: '/repo/dist/agentage-extension.json',
    };
    expect(buildLines(pushed, '/repo')).toEqual([
      'api     ghcr.io/agentage/probe-api:0.1.0  sha256:bbbbbbbb pushed',
      'record  dist/agentage-extension.json',
    ]);
  });

  it('names the one image, then one line of the parts it runs and skips (C7)', () => {
    const one: BuildResult = {
      ...RESULT,
      images: [],
      container: {
        tag: 'ghcr.io/agentage/probe:0.1.0',
        digest: DIGEST,
        runs: ['api', 'mcp', 'worker'],
        skipped: ['pages', 'ui'],
      },
      recordFile: '/repo/dist/agentage-container.json',
    };
    expect(buildLines(one, '/repo')).toEqual([
      'image   ghcr.io/agentage/probe:0.1.0  sha256:bbbbbbbb pushed',
      'runs: api, mcp, worker; skipped: pages, ui',
      'record  dist/agentage-container.json',
    ]);
    const container = { tag: 'ghcr.io/agentage/probe:0.1.0', runs: ['api'], skipped: [] };
    expect(buildLines({ ...RESULT, images: [], container })).toEqual([
      'image   ghcr.io/agentage/probe:0.1.0  built',
      'runs: api; skipped: none',
    ]);
  });
});
