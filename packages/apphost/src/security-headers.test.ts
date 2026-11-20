import { type IncomingHttpHeaders } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeUpstreams,
  docOf,
  startWithShell,
  type Started,
  upstream,
} from './test-support/cloud-start.js';
import { startHarness, type Harness } from './test-support/daemon-harness.js';
import { json, tempPackage } from '../../extension/src/test-support/packages.js';

let host: Started | undefined;
let daemon: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await host?.stop();
  await daemon?.daemon.stop();
  host = daemon = undefined;
  closeUpstreams();
  vi.restoreAllMocks();
});

// The values the edge sets (estate gateway-headers): never a second, different value.
const EDGE = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const OWN = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'origin-agent-cluster': '?1',
};
const HSTS = { 'strict-transport-security': 'max-age=31536000' };
const picked = (h: IncomingHttpHeaders) => ({
  ...Object.fromEntries(Object.keys({ ...EDGE, ...HSTS }).map((k) => [k, h[k]])),
  csp: h['content-security-policy'],
});
const ownOf = (h: IncomingHttpHeaders) =>
  Object.fromEntries(Object.keys(OWN).map((k) => [k, h[k]]));
const UP = { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "default-src 'none'" };

const started = async () => {
  const up = await upstream(docOf('echo'));
  up.custom = (req, res) =>
    req.url?.startsWith('/api/') ? (res.writeHead(200, UP).end(), true) : false;
  const rows = { extensions: [{ id: 'echo', expose: { api: 'public' } }], upstreams: [] };
  return startWithShell({ ...rows, upstreams: [{ id: 'echo', address: up.address }] });
};

describe('helmet on the cloud app: the edge values, no CSP of its own', () => {
  it.each([
    ['the host document', '/.well-known/agentage-host.json', {}],
    ['a miss', '/api/e2e-miss-1/x', {}],
    ['the shell page', '/', { accept: 'text/html' }],
    ['a shell file', '/shell/index.html', {}],
  ])('%s', async (_why, path, headers: Record<string, string>) => {
    host = await started();
    const res = await host.call(path, { headers });
    expect(picked(res.headers)).toEqual({ ...EDGE, ...HSTS, csp: undefined });
    expect(ownOf(res.headers)).toEqual(OWN);
  });

  it('a proxied answer keeps the upstream values, one value per name', async () => {
    host = await started();
    const res = await host.call('/api/echo/x');
    expect(res.status).toBe(200);
    expect(picked(res.headers)).toEqual({
      ...EDGE,
      ...HSTS,
      'x-frame-options': 'SAMEORIGIN',
      csp: UP['content-security-policy'],
    });
  });
});

describe('helmet on the daemon app', () => {
  it('the edge values on its answers, no HSTS on loopback http, no CSP on the shell page', async () => {
    const shellDir = await tempPackage({
      'package.json': json({ name: '@agentage/shell-dashboard', version: '0.1.0' }),
      'dist/index.html': '<!doctype html><title>shell</title>',
    });
    daemon = await startHarness({ shellDir });
    const at = (path: string) => `http://127.0.0.1:${daemon!.daemon.port}${path}`;
    for (const path of ['/', '/api/nosuch/x']) {
      const res = await fetch(at(path), { headers: { accept: 'text/html' } });
      const headers = Object.fromEntries(res.headers);
      expect(picked(headers)).toEqual({
        ...EDGE,
        'strict-transport-security': undefined,
        csp: undefined,
      });
    }
  });
});
