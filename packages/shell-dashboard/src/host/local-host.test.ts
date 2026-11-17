import { describe, expect, it, vi } from 'vitest';
import { appUserOf, createLocalHost, localScopes } from './local-host.js';

const call = (fetchImpl: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return { url, app: new Headers(init.headers).get('X-Agentage-App'), init };
};

describe('local host', () => {
  it('calls /api/{id}{path}, holds every verb of its own extension, no token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = createLocalHost('probe', { id: 'u1', email: 'a@b.test' }, fetchImpl);
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
    const host = createLocalHost('probe', null, fetchImpl);
    await host.request('fixture', '/items', { headers: { 'X-Agentage-App': 'fixture' } });
    const c = call(fetchImpl);
    expect(c.url).toBe('/api/probe/items');
    expect(c.app).toBe('probe');
  });

  it('a path that leaves /api/{id}/ is refused before any fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = createLocalHost('probe', null, fetchImpl);
    for (const path of ['/../fixture/secret', '/%2e%2e/fixture/x', '//evil.test/x'])
      await expect(host.request('probe', path, {}), path).rejects.toMatchObject({ status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
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
