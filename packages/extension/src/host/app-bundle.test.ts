import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryDocumentSchema } from '../discovery/discovery.schema.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../test-support/hosted-fixture.js';
import { AUDIENCE, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { json, tempDir } from '../test-support/packages.js';
import { serveHost, type ServedHost } from './serve-host.js';

const APP_MANIFEST = {
  ...NO_STORE_MANIFEST,
  agentage: {
    ...NO_STORE_MANIFEST.agentage,
    parts: { api: true, app: true },
    app: { title: 'Hosted', icon: 'store', order: 5 },
  },
};
const FILES = { entry: 'app-0123456789.js', css: 'app-abcdef0123.css' };

let issuer: TestIssuer;
const served: ServedHost[] = [];
beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  issuer = await startIssuer();
});
afterEach(async () => {
  for (const s of served.splice(0)) (s.server.close(), await s.host.stop());
  await issuer.close();
  vi.restoreAllMocks();
});

const appPackage = async (manifest: object, built: object | null = FILES) => {
  const dir = await hostedPackage(manifest);
  if (!built) return dir;
  await mkdir(join(dir, 'dist/app'), { recursive: true });
  await writeFile(join(dir, 'dist/app/app.json'), json(built));
  await writeFile(join(dir, 'dist/app', FILES.entry), 'export default () => null;');
  await writeFile(join(dir, 'dist/app', FILES.css), '.x{}');
  return dir;
};

// The one container, token-checked as on an app host: the app is anonymous all the same.
const serve = async (dir: string) => {
  const secrets = await tempDir('agentage-app-bundle-');
  await writeFile(join(secrets, 'api-token'), 't');
  const env = {
    PORT: '0',
    AGENTAGE_EXTENSION_DIR: dir,
    AGENTAGE_SECRETS_DIR: secrets,
    AGENTAGE_HOST_BIND: 'all',
    AGENTAGE_ISSUER: issuer.url,
    AGENTAGE_AUDIENCE: AUDIENCE,
    AGENTAGE_ORIGIN: 'http://hosted.next.agentage.io',
  };
  const s = await serveHost(env, { exit: vi.fn(), ready: vi.fn(), signals: [] });
  served.push(s);
  const port = (s.server.address() as { port: number }).port;
  return (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
};

describe('the one container serves the app part at /app/{id}/* (C4)', () => {
  it('/app/{id}/ is the nav row, as the daemon puts it in the host document', async () => {
    const get = await serve(await appPackage(APP_MANIFEST));
    const res = await get('/app/hosted/');
    expect([res.status, res.headers.get('cache-control')]).toEqual([200, 'no-cache']);
    expect(await res.json()).toEqual({
      title: 'Hosted',
      icon: 'store',
      order: 5,
      entry: `/app/hosted/${FILES.entry}`,
      css: `/app/hosted/${FILES.css}`,
    });
  });

  it('discovery lists app in serves and carries the same nav row', async () => {
    const get = await serve(await appPackage(APP_MANIFEST));
    const doc = (await (await get('/.well-known/agentage-extension.json')).json()) as object;
    const row = await (await get('/app/hosted/')).json();
    expect(doc).toMatchObject({ serves: ['api', 'app'], app: row });
    const host = { host: 'https://hosted.example.com' };
    expect(DiscoveryDocumentSchema.safeParse({ ...doc, ...host }).error?.issues).toBeUndefined();
  });

  it('bundle files are anonymous: hashed immutable, app.json no-cache, a miss 404', async () => {
    const get = await serve(await appPackage(APP_MANIFEST));
    const entry = await get(`/app/hosted/${FILES.entry}`);
    expect(entry.status).toBe(200);
    expect(entry.headers.get('cache-control')).toContain('immutable');
    expect((await get('/app/hosted/app.json')).headers.get('cache-control')).toBe('no-cache');
    expect((await get('/app/hosted/app-ffffffffff.js')).status).toBe(404);
    expect((await get('/app/hosted/../package.json')).status).toBe(404);
  });

  it.each([
    ['no app part', NO_STORE_MANIFEST, FILES],
    ['an app part never built', APP_MANIFEST, null],
    ['an app.json with no hashed names', APP_MANIFEST, { entry: 'index.js', css: 'x.css' }],
  ])('%s: /app/{id}/ is 404', async (_name, manifest, built) => {
    const get = await serve(await appPackage(manifest, built));
    expect((await get('/app/hosted/')).status).toBe(404);
    expect((await get(`/app/hosted/${FILES.entry}`)).status).toBe(404);
  });
});
