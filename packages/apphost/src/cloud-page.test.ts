import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { json, tempPackage } from '../../extension/src/test-support/packages.js';
import { cloudShell } from './cloud-page.js';
import { SHELL_PACKAGE, shellPackageDir } from './shell-package.js';
import { type Shell } from './shell-routes.js';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  type Rows,
  startCloud,
  type Started,
  upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const HTML = { accept: 'text/html' };
const KEY = { package: SHELL_PACKAGE, version: '9.1.0' };
const shellPackage = (version = KEY.version) =>
  tempPackage({
    'package.json': json({ name: SHELL_PACKAGE, version }),
    'dist/index.html': '<!doctype html><title>shell</title>',
    'dist/vendor/react.js': 'export default 1;',
  });

// echo: app public; inner: no app; the installation has a shell key unless `shell` is false.
const start = async (shell: Rows['shell'] | false = KEY, shellDir?: string) => {
  const echo = await upstream(docOf('echo', ['api', 'app']));
  const inner = await upstream(docOf('inner', ['api']));
  const extensions: Rows['extensions'] = [
    { id: 'echo', expose: { api: 'public', app: 'public' } },
    { id: 'inner', expose: { api: 'public' } },
  ];
  const upstreams = [
    { id: 'echo', address: echo.address },
    { id: 'inner', address: inner.address },
  ];
  const rows = { extensions, upstreams, ...(shell && { shell }) };
  host = await startCloud(await cloudEnv(rows), { shellDir: shellDir ?? (await shellPackage()) });
  return host.call;
};

describe('a cloud host with a shell key serves the shell package (J.4.5 row 1)', () => {
  it('the page at / and at the id of a public app, its files at /shell/*, the key in the host document', async () => {
    const call = await start();
    const page = await call('/', { headers: HTML });
    expect([page.status, page.body]).toEqual([200, '<!doctype html><title>shell</title>']);
    expect((await call('/echo/home', { headers: HTML })).status).toBe(200);
    expect((await call('/shell/vendor/react.js')).status).toBe(200);
    const doc = JSON.parse((await call('/.well-known/agentage-host.json')).body);
    expect(doc.shell).toEqual(KEY);
  });

  it.each([
    ['an id with no app', '/inner/home', HTML, 404],
    ['an unknown id', '/nosuch', HTML, 404],
    ['no HTML asked', '/', { accept: 'application/json' }, 404],
    ['a file that is not there', '/shell/nope.js', {}, 404],
    ['a dot file', '/shell/.env', {}, 404],
  ])('%s: %s is %i', async (_why, path, headers, status) => {
    const call = await start();
    expect((await call(path, { headers })).status).toBe(status);
  });

  it('the page is the 404 page for an id with no app (HTML, the frame shows not found)', async () => {
    const call = await start();
    const res = await call('/nosuch', { headers: HTML });
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('the shell key decides (J.4.5 rows 1 and 7)', () => {
  it('no shell key: no page and no shell file (404)', async () => {
    const call = await start(false);
    expect((await call('/', { headers: HTML })).status).toBe(404);
    expect((await call('/shell/vendor/react.js')).status).toBe(404);
  });

  it('a key that names another version than the program carries refuses the start', async () => {
    await expect(start(KEY, await shellPackage('9.0.0'))).rejects.toThrow(
      `names ${SHELL_PACKAGE}@9.1.0, the program carries ${SHELL_PACKAGE}@9.0.0`
    );
  });

  it('a key that names another package refuses the start; a key with no package installed too', async () => {
    const other = { host: 'site', extensions: [], shell: { ...KEY, package: '@agentage/other' } };
    await expect(cloudShell(other, await shellPackage())).rejects.toThrow('the program carries');
    const named = { host: 'site', extensions: [], shell: KEY };
    await expect(cloudShell(named, undefined)).rejects.toThrow('the program carries none');
  });

  it('the default package: the version the key names is the version served', async () => {
    const dir = shellPackageDir() as string;
    const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Shell;
    const named = { host: 'site', extensions: [], shell: { package: SHELL_PACKAGE, version } };
    expect((await cloudShell(named, dir))?.version).toBe(version);
  });
});
