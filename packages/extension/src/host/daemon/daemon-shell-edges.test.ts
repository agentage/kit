import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { json, tempDir, tempPackage } from '../../test-support/packages.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const app = { title: 'H' };
const FILES = { entry: 'app-0123456789.js', css: 'app-0123456789.css' };
const withApp = (parts: object) => ({
  ...NO_STORE_MANIFEST,
  agentage: { ...NO_STORE_MANIFEST.agentage, parts, app },
});

const built = async (dir: string, dist = 'dist') => {
  await mkdir(join(dir, dist, 'app'), { recursive: true });
  await writeFile(join(dir, dist, 'app/app.json'), json(FILES));
};

const at = (path: string) => `http://127.0.0.1:${h!.daemon.port}${path}`;
const rows = async () =>
  ((await (await fetch(at('/.well-known/agentage-host.json'))).json()) as { extensions: object[] })
    .extensions;

describe('the shell routes at their edges', () => {
  it('a client with */* or no Accept gets the page at /', async () => {
    const shellDir = await tempPackage({
      'package.json': json({ name: '@agentage/shell-dashboard', version: '0.1.0' }),
      'dist/index.html': '<!doctype html>',
    });
    h = await startHarness({ shellDir });
    expect((await fetch(at('/'), { headers: { accept: '*/*' } })).status).toBe(200);
    expect((await fetch(at('/'))).status).toBe(200);
  });

  it('a shell folder that is not a package: the daemon runs, no page, no shell key', async () => {
    h = await startHarness({ shellDir: await tempDir() });
    expect((await fetch(at('/'), { headers: { accept: 'text/html' } })).status).toBe(404);
    const doc = await (await fetch(at('/.well-known/agentage-host.json'))).json();
    expect(doc).toEqual({ host: 'local', kind: 'local', extensions: [] });
  });

  it('a full reload from dist.next keeps the app row when dist.next has app/', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir);
    const dir = await hostedPackage(withApp({ api: true, app: true }));
    await built(dir);
    await h.call('POST', '/host/extensions', { source: dir });
    await cp(join(dir, 'dist'), join(dir, 'dist.next'), { recursive: true });
    const reload = await h.call('POST', '/host/extensions/hosted/reload', {});
    expect(reload.body).toMatchObject({ data: { reloaded: true } });
    expect(await rows()).toMatchObject([{ id: 'hosted', app: { title: 'H' } }]);
  });

  it('an app-only package installs and has its row', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir);
    const dir = await hostedPackage(withApp({ app: true }));
    await built(dir);
    const added = await h.call('POST', '/host/extensions', { source: dir });
    expect(added.status).toBe(201);
    expect(await rows()).toMatchObject([{ id: 'hosted', parts: ['app'], app: { title: 'H' } }]);
  });
});
