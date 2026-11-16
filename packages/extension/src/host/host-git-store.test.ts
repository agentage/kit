import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLog } from '../log/log.js';
import { GIT_MANIFEST, gitPackage } from '../test-support/git-fixture.js';
import { hostedPackage, HOSTED_MANIFEST } from '../test-support/hosted-fixture.js';
import { serveApp } from '../test-support/http.js';
import { tempDir } from '../test-support/packages.js';
import { openGitStore } from './host-git-store.js';
import { hostExtension } from './host-extension.js';

const URL_WITH_PW = 'http://gitter:s3cret-pw@store-git_store:8080/gitter/';
let lines: string[] = [];
const quiet = () => {
  lines = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(
    (chunk) => (lines.push(String(chunk)), true)
  );
};
const log = () => createLog({ extension: 'gitter', part: 'api', version: '0.1.0' });
const pkgOf = (store?: string) => ({
  ...GIT_MANIFEST,
  agentage: { id: 'gitter', parts: store ? { api: true, store } : { api: true } },
});
afterEach(() => vi.restoreAllMocks());

describe('a git store in the host (G5), in process', () => {
  it('ctx.store.gitRoot is data/{id}: the api commits and pushes there; /health checks it', async () => {
    quiet();
    const root = await tempDir('agentage-git-');
    const remote = join(root, 'store-git.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    const dataDir = join(root, 'data', 'gitter');
    const host = await hostExtension(await gitPackage(), { dataDir });
    const served = await serveApp(host.app);
    const at = `${served.url}/api/gitter/c?remote=${encodeURIComponent(remote)}`;
    const { data } = (await (await fetch(at, { method: 'POST' })).json()) as {
      data: { sha: string };
    };
    await served.close();
    expect(data).toMatchObject({ root: dataDir, remote: false });
    const pushed = execFileSync('git', [
      '--git-dir',
      remote,
      'rev-parse',
      'refs/vaults/u1/default/main',
    ]);
    expect(String(pushed).trim()).toBe(data.sha);
    expect(await host.health()).toMatchObject({
      data: { checks: { store: 'ok', 'store:git': 'ok' } },
    });
    expect(await readFile(`${dataDir}.lock`, 'utf8')).toBe(String(process.pid));
    await host.stop();
  });

  it('is not a postgres: query says so; a package without git gets undefined', async () => {
    quiet();
    const at = { dataDir: join(await tempDir('agentage-git-'), 'g'), openMs: 1000 };
    const store = await openGitStore(pkgOf('git') as never, at, log());
    await expect(store?.query('select 1')).rejects.toThrow('a git store has no query');
    await store?.close();
    expect(await openGitStore(pkgOf('postgres') as never, at, log())).toBeUndefined();
    expect(await openGitStore(HOSTED_MANIFEST as never, at, log())).toBeUndefined();
  });

  it('one writer: a second open of the same folder waits for the lock, then refuses', async () => {
    quiet();
    const at = { dataDir: join(await tempDir('agentage-git-'), 'g'), openMs: 300 };
    const first = await openGitStore(pkgOf('git') as never, at, log());
    await expect(openGitStore(pkgOf('git') as never, at, log())).rejects.toMatchObject({
      code: 'DATA_DIR_LOCKED',
    });
    await first?.close();
  });

  it('no data folder: a temp root, with a warning', async () => {
    quiet();
    const store = await openGitStore(pkgOf('git') as never, { dataDir: '', openMs: 1000 }, log());
    expect(store?.gitRoot).toMatch(/agentage-git-/);
    expect(lines.join('')).toContain('the git store is in a temp folder');
    await store?.close();
  });
});

describe('the push remote from AGENTAGE_STORE_URL_FILE (cloud)', () => {
  it('ctx.store.gitRemote is the URL; no log line prints it', async () => {
    quiet();
    const root = await tempDir('agentage-git-');
    const file = join(root, 'store-url');
    await writeFile(file, `${URL_WITH_PW}\n`);
    const at = { dataDir: join(root, 'g'), openMs: 1000, file };
    const store = await openGitStore(pkgOf('git') as never, at, log());
    expect(store).toMatchObject({ gitRemote: URL_WITH_PW, kind: 'git' });
    expect(lines.join('')).toContain('git store opened');
    expect(lines.join('')).not.toContain('s3cret-pw');
    await store?.close();
  });

  it('a file with no http URL refuses the start and names the file, never its text', async () => {
    quiet();
    const root = await tempDir('agentage-git-');
    const file = join(root, 'store-url');
    await writeFile(file, 'ssh://gitter:s3cret-pw@host/gitter\n');
    const at = { dataDir: join(root, 'g'), openMs: 1000, file };
    const opened = openGitStore(pkgOf('git') as never, at, log());
    await expect(opened).rejects.toThrow(
      `AGENTAGE_STORE_URL_FILE ${file}: holds no http:// or https:// URL for the git store`
    );
    await expect(opened).rejects.not.toThrow('s3cret-pw');
  });

  it('a postgres package keeps its own store: the git path is not taken', async () => {
    quiet();
    const host = await hostExtension(await hostedPackage(), {
      dataDir: '',
      secrets: { 'api-token': 't' },
    });
    expect(await host.health()).toMatchObject({ data: { checks: { store: 'ok' } } });
    await host.stop();
  });
});
