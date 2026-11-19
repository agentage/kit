import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from './test-support/daemon-harness.js';
import { gitPackage, NO_GIT_MANIFEST } from '../../extension/src/test-support/git-fixture.js';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { BUILT_MAIN as MAIN } from '../../extension/src/test-support/launch-spec.js';
import { forkLaunch } from './child.js';
import { sealOf } from './seal.js';

const SEALED = sealOf(process.versions.node) === 'on';

let h: Harness;
let remote = '';
const data = async (method: string, path: string) =>
  ((await h.call(method, path)).body as { data: Record<string, string> }).data;

describe.runIf(SEALED)('a git store in a sealed child (G5, G6, PD2)', () => {
  beforeAll(async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    remote = join(await tempDir('agentage-store-git-'), 'store-git.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    h = await startHarness({ launch: forkLaunch(MAIN, undefined, 60) });
    await writeFile(join(h.configDir, 'outside.txt'), 'x');
    await h.call('POST', '/host/extensions', { source: await gitPackage() });
    await h.call('POST', '/host/extensions', { source: await gitPackage(NO_GIT_MANIFEST) });
  }, 60_000);
  afterAll(async () => {
    await h.daemon.stop();
    vi.restoreAllMocks();
  });

  it('commits in data/{id} and pushes to a bare repo; /health says seal partial, status ok', async () => {
    const done = await data('POST', `/api/gitter/c?remote=${encodeURIComponent(remote)}`);
    expect(done).toMatchObject({ root: join(h.configDir, 'data', 'gitter') });
    const pushed = execFileSync('git', [
      '--git-dir',
      remote,
      'rev-parse',
      'refs/vaults/u1/default/main',
    ]);
    expect(String(pushed).trim()).toBe(done['sha']);
    expect((await h.call('GET', '/health')).body).toMatchObject({
      status: 'ok',
      extensions: [
        { id: 'gitter', state: 'running', seal: 'partial' },
        { id: 'nogit', state: 'running', seal: 'on' },
      ],
    });
  });

  it('node:fs stays sealed for the git child; a package without git cannot spawn', async () => {
    const outside = encodeURIComponent(join(h.configDir, 'outside.txt'));
    expect(await data('GET', `/api/gitter/r?path=${outside}`)).toEqual({
      code: 'ERR_ACCESS_DENIED',
    });
    expect(await data('POST', '/api/nogit/c')).toEqual({ code: 'ERR_ACCESS_DENIED' });
  });
});
