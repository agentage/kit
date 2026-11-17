import { describe, expect, it, vi } from 'vitest';
import { appUserOf, createLocalHost, localAt, localScopes } from './local-host.js';

const PROBE = { id: 'probe', version: '0.9.0' };
const AT = localAt('http://127.0.0.1:4243');

const call = (fetchImpl: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return { url, app: new Headers(init.headers).get('X-Agentage-App'), init };
};

describe('local host', () => {
  it('calls /api/{id}{path}, holds every verb of its own extension, no token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = createLocalHost(PROBE, { id: 'u1', email: 'a@b.test' }, fetchImpl, AT);
    await host.request('probe', '/echo?msg=hi', { method: 'POST' });
    const c = call(fetchImpl);
    expect(c.url).toBe('/api/probe/echo?msg=hi');
    expect(c.app).toBe('probe');
    expect(c.init.method).toBe('POST');
    expect(new Headers(c.init.headers).has('Authorization')).toBe(false);
    expect(host.scopes).toEqual(localScopes('probe'));
    expect(host.scopes).toEqual(['probe:read', 'probe:write', 'probe:admin']);
    expect(host.user).toEqual({ id: 'u1', email: 'a@b.test' });
  });

  it('is bound to its app: another id and another X-Agentage-App are both overridden', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = createLocalHost(PROBE, null, fetchImpl, AT);
    await host.request('fixture', '/items', { headers: { 'X-Agentage-App': 'fixture' } });
    const c = call(fetchImpl);
    expect(c.url).toBe('/api/probe/items');
    expect(c.app).toBe('probe');
  });

  it('a path that leaves /api/{id}/ is refused before any fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = createLocalHost(PROBE, null, fetchImpl, AT);
    for (const path of ['/../fixture/secret', '/%2e%2e/fixture/x', '//evil.test/x'])
      await expect(host.request('probe', path, {}), path).rejects.toMatchObject({ status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('C7: kind local, the daemon origin as url, the version of its extension', () => {
    const host = createLocalHost(PROBE, null, vi.fn(), AT);
    expect([host.kind, host.url, host.version]).toEqual([
      'local',
      'http://127.0.0.1:4243',
      '0.9.0',
    ]);
    expect(createLocalHost(PROBE, null, vi.fn(), { ...AT, kind: 'desktop' }).kind).toBe('desktop');
  });

  it('keeps a name when the session has one; signed out is null', () => {
    expect(appUserOf({ id: 'u', email: 'e', name: 'N' })).toEqual({
      id: 'u',
      email: 'e',
      name: 'N',
    });
    expect(appUserOf(null)).toBeNull();
    expect(appUserOf({ id: 'u_alice' })).toEqual({ id: 'u_alice' });
  });
});
