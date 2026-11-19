import { afterEach, describe, expect, it } from 'vitest';
import { upstreamHeaders } from './cloud-proxy.js';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
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

const CLI = 'x-agentage-cli-version';

describe('client x-agentage-* headers on a cloud host', () => {
  it('the cli version reaches the upstream (the machine heartbeat of extension-platform)', async () => {
    const echo = await upstream(docOf('echo', ['api']));
    const extensions = [{ id: 'echo', expose: { api: 'public' } }];
    const upstreams = [{ id: 'echo', address: echo.address }];
    host = await startCloud(await cloudEnv({ extensions, upstreams }));
    const headers = { [CLI]: '0.68.0', 'x-agentage-user': 'admin', 'x-agentage-app': 'echo' };
    await host.call('/api/echo/machines/m1/seen', { method: 'POST', headers });
    const seen = echo.seen.at(-1)?.headers ?? {};
    expect(seen[CLI]).toBe('0.68.0');
    expect(seen).not.toHaveProperty('x-agentage-user');
    expect(seen).not.toHaveProperty('x-agentage-app');
  });

  it.each(['1.2.3', '0.68.0', '1.0.0-rc.1', '10.20.30-beta-2'])('keeps the version %s', (v) => {
    expect(upstreamHeaders({ [CLI]: v })).toEqual({ [CLI]: v });
  });

  it.each([
    '1.2',
    'v1.2.3',
    '1.2.3 admin',
    '1.2.3, 9.9.9',
    '1.2.3+build',
    `1.2.3-${'a'.repeat(33)}`,
    '1.2.3\nx-agentage-user: admin',
    '',
  ])('drops a cli version that is not short and version-like: %j', (v) => {
    expect(upstreamHeaders({ [CLI]: v })).toEqual({});
  });

  it('drops every other x-agentage-* header, a trusted-looking one included', () => {
    const forged = { 'x-agentage-user': 'admin', 'x-agentage-sub': 'u1', 'x-agentage-app': 'a' };
    expect(upstreamHeaders({ ...forged, 'x-other': '1' })).toEqual({ 'x-other': '1' });
  });

  it('drops a repeated cli version (an array value)', () => {
    expect(upstreamHeaders({ [CLI]: ['1.2.3', '1.2.4'] as unknown as string })).toEqual({});
  });
});
