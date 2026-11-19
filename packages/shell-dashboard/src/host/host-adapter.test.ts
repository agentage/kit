import { describe, expect, it, vi } from 'vitest';
import { adapterFor, adapterKindOf } from './host-adapter.js';
import type { Session } from './host.types.js';

const PROBE = { id: 'probe', version: '0.9.0' };
const ORIGIN = 'https://platform.next.agentage.io';
const USER = { id: 'u1', email: 'a@b.test' };
const at = (host: unknown): Session => ({ user: USER, host }) as Session;

describe('one adapter for each host kind (J.4.5 row 6)', () => {
  it('kind local: the daemon adapter, every verb of its own extension', () => {
    const host = adapterFor(PROBE, at({ kind: 'local' }), vi.fn(), 'http://127.0.0.1:4243');
    expect([host?.kind, host?.url, host?.version]).toEqual([
      'local',
      'http://127.0.0.1:4243',
      '0.9.0',
    ]);
    expect(host?.scopes).toEqual(['probe:read', 'probe:write', 'probe:admin']);
  });

  it('kind cloud: the cloud adapter, the page origin, no scope hint, the session user', () => {
    const host = adapterFor(PROBE, at({ kind: 'cloud' }), vi.fn(), ORIGIN);
    expect([host?.kind, host?.url, host?.version]).toEqual(['cloud', ORIGIN, '0.9.0']);
    expect(host?.scopes).toEqual([]);
    expect(host?.user).toEqual(USER);
  });

  it('kind cloud: same-origin /api/{id}{path}, bound to its app, no token in the page', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = adapterFor(PROBE, at({ kind: 'cloud' }), fetchImpl, ORIGIN);
    await host?.request('fixture', '/echo?msg=hi', { headers: { 'X-Agentage-App': 'fixture' } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('/api/probe/echo?msg=hi');
    expect(headers.get('X-Agentage-App')).toBe('probe');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('kind cloud: a path that leaves /api/{id}/ is refused before any fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const host = adapterFor(PROBE, at({ kind: 'cloud' }), fetchImpl, ORIGIN);
    await expect(host?.request('probe', '/../fixture/x', {})).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an unknown kind, a failed read or a host name gives no adapter: never local', () => {
    for (const host of [{ kind: 'desktop' }, { kind: 'mainframe' }, {}, null, 'platform'])
      expect(adapterFor(PROBE, at(host), vi.fn(), ORIGIN), JSON.stringify(host)).toBeNull();
    expect(adapterKindOf(at({ kind: 'cloud' }))).toBe('cloud');
    expect(adapterKindOf(at(null))).toBeNull();
  });
});
