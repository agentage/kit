import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { inspect } from 'node:util';
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
const WHO = {
  GIT_AUTHOR_NAME: 'k',
  GIT_AUTHOR_EMAIL: 'k@x',
  GIT_COMMITTER_NAME: 'k',
  GIT_COMMITTER_EMAIL: 'k@x',
};
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
  it('ctx.store.git: remote with no credential; the credential is a header in env only', async () => {
    quiet();
    const root = await tempDir('agentage-git-');
    const file = join(root, 'store-url');
    await writeFile(file, `${URL_WITH_PW}\n`);
    const store = await openGitStore(
      pkgOf('git') as never,
      { dataDir: join(root, 'g'), openMs: 1000, file },
      log()
    );
    expect(store?.git?.remote).toBe('http://store-git_store:8080/gitter/');
    const basic = Buffer.from('gitter:s3cret-pw').toString('base64');
    expect(store?.git?.env).toMatchObject({
      GIT_CONFIG_KEY_1: 'http.http://store-git_store:8080/gitter/.extraHeader',
      GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`,
    });
    expect(lines.join('')).toContain('git store opened');
    for (const shown of [lines.join(''), JSON.stringify(store), inspect(store, { depth: 9 })])
      expect(shown).not.toContain(basic);
    await store?.close();
  });

  it('the hardened env: only PATH from the parent, no host config, no hooks, no ext::', async () => {
    quiet();
    const dataDir = join(await tempDir('agentage-git-'), 'g');
    const store = await openGitStore(pkgOf('git') as never, { dataDir, openMs: 1000 }, log());
    const env = store!.git!.env;
    expect(env).toEqual({
      PATH: process.env['PATH'],
      HOME: dataDir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'file:http:https',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/dev/null',
    });
    expect(store?.git?.cwd).toBe(dataDir);
    const run = (...args: string[]) =>
      spawnSync('git', args, { cwd: dataDir, env: { ...env, ...WHO }, encoding: 'utf8' });
    run('init', '-q', 'r');
    await writeFile(join(dataDir, 'r/.git/hooks/pre-commit'), '#!/bin/sh\ntouch ../hooked\n', {
      mode: 0o755,
    });
    expect(run('-C', 'r', 'commit', '-q', '--allow-empty', '-m', 'x').status).toBe(0);
    await expect(readFile(join(dataDir, 'hooked'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(run('ls-remote', 'ext::sh -c id').stderr).toContain("transport 'ext' not allowed");
    await store?.close();
  });

  it('a push sends the credential as a header: never in argv, a URL or git error text', async () => {
    quiet();
    const seen: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(403).end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const root = await tempDir('agentage-git-');
    const file = join(root, 'store-url');
    await writeFile(file, `http://gitter:s3cret-pw@127.0.0.1:${port}/gitter/`);
    const store = await openGitStore(
      pkgOf('git') as never,
      { dataDir: join(root, 'g'), openMs: 1000, file },
      log()
    );
    const args = ['ls-remote', `${store!.git!.remote}u1/default.git`];
    const out = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (done) => {
        const git = spawn('git', args, { cwd: store!.git!.cwd, env: store!.git!.env });
        let stdout = '';
        let stderr = '';
        git.stdout.on('data', (chunk) => (stdout += String(chunk)));
        git.stderr.on('data', (chunk) => (stderr += String(chunk)));
        git.on('close', (status) => done({ status, stdout, stderr }));
      }
    );
    server.close();
    expect(out.status).not.toBe(0);
    expect(seen[0]).toBe(`Basic ${Buffer.from('gitter:s3cret-pw').toString('base64')}`);
    for (const shown of [args.join(' '), out.stdout, out.stderr, lines.join('')])
      expect(shown).not.toContain('s3cret-pw');
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
