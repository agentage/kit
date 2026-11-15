import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';
import { rawRequest } from '../../test-support/http.js';

let h: Harness;
beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  h = await startHarness();
});
afterEach(async () => {
  await h.daemon.stop();
  vi.restoreAllMocks();
});

const raw = (headers: Record<string, string>, path = '/health', method = 'GET') =>
  rawRequest(h.daemon.port, headers, path, method);

const code = (status: number, value: string) => ({
  status,
  body: { success: false, error: { code: value } },
});

describe('daemon refusals', () => {
  it('403 on every route and method for another Host, Origin, or a cross-site or same-site fetch', async () => {
    const at = { host: `127.0.0.1:${h.daemon.port}` };
    const routes = [
      ['GET', '/health'],
      ['GET', '/host/extensions'],
      ['POST', '/host/extensions'],
      ['PATCH', '/host/extensions/hosted'],
      ['DELETE', '/host/extensions/hosted'],
      ['GET', '/api/hosted/echo'],
      ['POST', '/api/hosted/echo'],
    ];
    const refused = [
      { host: 'evil.example:4243' },
      { ...at, origin: 'https://evil.example' },
      { ...at, 'sec-fetch-site': 'cross-site' },
      { ...at, 'sec-fetch-site': 'same-site' },
    ];
    for (const [method, path] of routes)
      for (const headers of refused)
        expect([method, path, (await raw(headers, path, method)).status]).toEqual([
          method,
          path,
          403,
        ]);
    const fromHere = { ...at, 'sec-fetch-site': 'same-origin' };
    expect((await raw(fromHere)).status).toBe(200);
    expect((await raw({ ...at, 'sec-fetch-site': 'none' })).status).toBe(200);
  });

  it('a Host by either name passes; an Origin must be the daemon', async () => {
    const at = `127.0.0.1:${h.daemon.port}`;
    expect((await raw({ host: 'evil.example:4243' })).status).toBe(403);
    expect((await raw({ host: `localhost:${h.daemon.port}` })).status).toBe(200);
    expect((await raw({ host: `[::1]:${h.daemon.port}` })).status).toBe(403);
    expect((await raw({ host: at, origin: 'https://evil.example' })).status).toBe(403);
    expect((await raw({ host: at, origin: `http://${at}` })).status).toBe(200);
    expect(JSON.parse((await raw({ host: 'x' })).body)).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
  });

  it('400 for a bad body, the reserved id host or a relative source; 409 for an id installed twice', async () => {
    expect(await h.call('POST', '/host/extensions', { nope: 1 })).toMatchObject(
      code(400, 'VALIDATION_ERROR')
    );
    expect(await h.call('POST', '/host/extensions', { source: 'relative/dir' })).toMatchObject(
      code(400, 'VALIDATION_ERROR')
    );
    const host = { ...HOSTED_MANIFEST, agentage: { ...HOSTED_MANIFEST.agentage, id: 'host' } };
    const refused = await h.call('POST', '/host/extensions', { source: await hostedPackage(host) });
    expect(refused).toMatchObject({
      status: 400,
      body: { error: { message: 'the id host is reserved' } },
    });
    const dir = await hostedPackage();
    await h.call('POST', '/host/extensions', { source: dir });
    expect(await h.call('POST', '/host/extensions', { source: dir })).toMatchObject(
      code(409, 'CONFLICT')
    );
    expect(await h.call('POST', '/host/extensions', { source: '/nonexistent/x' })).toMatchObject(
      code(400, 'VALIDATION_ERROR')
    );
  });

  it('501 in the envelope for { id } without an installer; a version on a folder is 400', async () => {
    const market = await h.call('POST', '/host/extensions', { id: 'probe' });
    expect(market).toMatchObject({
      status: 501,
      body: { success: false, error: { code: 'UNAVAILABLE' } },
    });
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    expect(await h.call('PATCH', '/host/extensions/hosted', { version: '2.0.0' })).toMatchObject(
      code(400, 'VALIDATION_ERROR')
    );
  });

  it('404 in the envelope for an id not installed, on each route and under /api/', async () => {
    expect(await h.call('PATCH', '/host/extensions/ghost', {})).toMatchObject(
      code(404, 'NOT_FOUND')
    );
    expect(await h.call('DELETE', '/host/extensions/ghost')).toMatchObject(code(404, 'NOT_FOUND'));
    expect(await h.call('GET', '/api/ghost/echo')).toMatchObject(code(404, 'NOT_FOUND'));
    expect(await h.call('GET', '/nowhere')).toMatchObject(code(404, 'NOT_FOUND'));
  });

  it('a failed start is failed with its error in the list and in /health', async () => {
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    const error = 'api refused to start: secret api-token has no value';
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
      data: [{ state: 'failed', error }],
    });
    expect((await h.call('GET', '/health')).body).toMatchObject({
      status: 'degraded',
      extensions: [{ state: 'failed', error }],
    });
    expect(await h.call('GET', '/api/hosted/echo')).toMatchObject(code(503, 'UNAVAILABLE'));
  });
});
