import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { json, tempPackage } from '../../test-support/packages.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const APP_MANIFEST = {
  ...NO_STORE_MANIFEST,
  agentage: {
    ...NO_STORE_MANIFEST.agentage,
    parts: { api: true, app: true },
    app: { title: 'Hosted', icon: 'radar', order: 10 },
  },
};
const FILES = { entry: 'app-0123456789.js', css: 'app-abcdef0123.css' };
const HTML = '<!doctype html><title>shell</title>';

const shellPackage = () =>
  tempPackage({
    'package.json': json({ name: '@agentage/shell-dashboard', version: '0.1.0' }),
    'dist/index.html': HTML,
    'dist/vendor/react.js': 'export default 1;',
  });

// An app package with a built dist/app, installed and running.
const appRunning = async (built = FILES) => {
  h = await startHarness({ shellDir: await shellPackage() });
  await writeSecrets(h.configDir);
  const dir = await hostedPackage(APP_MANIFEST);
  await mkdir(join(dir, 'dist/app'), { recursive: true });
  await writeFile(join(dir, 'dist/app/app.json'), json(built));
  await writeFile(join(dir, 'dist/app/index.js'), `export { default } from './${built.entry}';\n`);
  await writeFile(join(dir, 'dist/app', built.entry), 'export default () => null;');
  await writeFile(join(dir, 'dist/app', built.css), '.x{}');
  expect((await h.call('POST', '/host/extensions', { source: dir })).status).toBe(201);
  return dir;
};

const at = (path: string) => `http://127.0.0.1:${h!.daemon.port}${path}`;
const html = (path: string, accept = 'text/html') => fetch(at(path), { headers: { accept } });

describe('the shell page (S1.2.1 rows 1, 5, 6, 8)', () => {
  it('/ and /{id}/* answer the shell page; an id with no app is the same page with 404', async () => {
    await appRunning();
    for (const [path, status] of [
      ['/', 200],
      ['/hosted', 200],
      ['/hosted/home/x', 200],
      ['/nope/x', 404],
    ] as const) {
      const res = await html(path);
      expect([path, res.status, await res.text()]).toEqual([path, status, HTML]);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
    expect((await html('/nope/x', '*/*')).status).toBe(404);
  });

  it('HEAD answers like GET with no body; a daemon path stays the JSON 404', async () => {
    await appRunning();
    const head = (path: string) =>
      fetch(at(path), { method: 'HEAD', headers: { accept: 'text/html' } });
    for (const [path, status] of [
      ['/', 200],
      ['/nope', 404],
    ] as const) {
      const res = await head(path);
      expect([path, res.status, res.headers.get('content-type')]).toEqual([
        path,
        status,
        expect.stringContaining('text/html'),
      ]);
      expect(await res.text()).toBe('');
    }
    const api = await head('/api/nope/x');
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).not.toContain('text/html');
  });

  it('a JSON client and the daemon paths keep the JSON 404 envelope', async () => {
    await appRunning();
    for (const [path, accept] of [
      ['/nope/x', 'application/json'],
      ['/health/x', 'text/html'],
      ['/shell/nope.js', 'text/html'],
    ] as const) {
      const res = await html(path, accept);
      expect([path, res.status, await res.json()]).toMatchObject([
        path,
        404,
        { error: { code: 'NOT_FOUND' } },
      ]);
    }
    expect(await (await fetch(at('/shell/vendor/react.js'))).text()).toBe('export default 1;');
  });

  it('discovery: the nav row of each app and the shell package', async () => {
    await appRunning();
    const doc = await (await fetch(at('/.well-known/agentage-host.json'))).json();
    expect(doc).toEqual({
      host: 'local',
      kind: 'local',
      shell: { package: '@agentage/shell-dashboard', version: '0.1.0' },
      extensions: [
        {
          id: 'hosted',
          version: '1.0.0',
          commit: '0'.repeat(40),
          state: 'running',
          parts: ['api', 'app'],
          expose: {},
          app: {
            title: 'Hosted',
            icon: 'radar',
            order: 10,
            entry: '/app/hosted/app-0123456789.js',
            css: '/app/hosted/app-abcdef0123.css',
          },
        },
      ],
    });
  });

  it('no shellDir: no page at /, discovery has no shell key', async () => {
    h = await startHarness();
    expect((await html('/')).status).toBe(404);
    const doc = await (await fetch(at('/.well-known/agentage-host.json'))).json();
    expect(doc).toEqual({ host: 'local', kind: 'local', extensions: [] });
  });
});

describe('/app/{id}/* (S1.2.2 row 7, K5)', () => {
  it('index.js and app.json no-cache, hashed files immutable', async () => {
    await appRunning();
    const cache = async (path: string) => {
      const res = await fetch(at(path));
      return [res.status, res.headers.get('cache-control')];
    };
    expect(await cache('/app/hosted/index.js')).toEqual([200, 'no-cache']);
    expect(await cache('/app/hosted/app.json')).toEqual([200, 'no-cache']);
    const immutable = [200, 'public, max-age=31536000, immutable'];
    expect(await cache('/app/hosted/app-0123456789.js')).toEqual(immutable);
    expect(await cache('/app/hosted/app-abcdef0123.css')).toEqual(immutable);
  });

  it('404 outside dist/app, for a missing file, an id with no app, a disabled one', async () => {
    await appRunning();
    for (const path of [
      '/app/hosted/../package.json',
      '/app/hosted/%2e%2e/%2e%2e/package.json',
      '/app/hosted/..%2f..%2fpackage.json',
      '/app/hosted/nope.js',
      '/app/nope/index.js',
    ])
      expect([path, (await fetch(at(path))).status]).toEqual([path, 404]);
    await h!.call('PATCH', '/host/extensions/hosted', { enabled: false });
    expect((await fetch(at('/app/hosted/index.js'))).status).toBe(404);
  });
});

describe('X-Agentage-App (S1.2.2 row 10, K10)', () => {
  it('403 when the header names another id; the own id passes', async () => {
    await appRunning();
    const call = (app: string) =>
      fetch(at('/api/hosted/echo?msg=hi'), { headers: { 'x-agentage-app': app } });
    const foreign = await call('probe');
    expect([foreign.status, await foreign.json()]).toMatchObject([
      403,
      { error: { code: 'FORBIDDEN' } },
    ]);
    expect((await call('hosted')).status).toBe(200);
  });

  it('/files/{id} and /connector/{id} refuse another app before the child', async () => {
    await appRunning();
    for (const path of ['/files/hosted/a.txt', '/connector/hosted']) {
      const res = await fetch(at(path), { headers: { 'x-agentage-app': 'probe' } });
      expect([path, res.status]).toEqual([path, 403]);
    }
  });
});
