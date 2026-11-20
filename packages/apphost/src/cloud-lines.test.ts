import { afterEach, describe, expect, it } from 'vitest';
import { cloudLog } from './cloud-host.js';
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

type Line = { kind?: string; msg?: string; fields?: Record<string, unknown> } & Record<
  string,
  unknown
>;

// A cloud host with one row `echo` at an upstream that answers `doc`; every log line kept.
const startWith = async (doc: unknown) => {
  const up = await upstream(doc);
  const texts: string[] = [];
  const log = cloudLog('0.0.0', (text) => texts.push(text));
  const rows = { extensions: [{ id: 'echo', expose: { api: 'public' } }], upstreams: [] };
  const env = await cloudEnv({ ...rows, upstreams: [{ id: 'echo', address: up.address }] });
  host = await startCloud(env, { log });
  const lines = () => texts.map((t) => JSON.parse(t) as Line);
  return { up, host, lines, texts };
};

describe('a refused upstream document is one log line (the stub router did the same)', () => {
  it('names the upstream and the row id, also for a document with no id; once, not per read', async () => {
    const { up, host, lines } = await startWith({ not: 'a document' });
    await host.refresh();
    const refused = lines().filter((l) => l.msg === 'document refused');
    expect(refused).toHaveLength(1);
    expect(String(refused[0]?.fields?.['line'])).toMatch(`${up.address} echo: invalid`);
  });

  it('a document of another id names the row it was read for', async () => {
    const { up, lines } = await startWith(docOf('other'));
    const refused = lines().filter((l) => l.msg === 'document refused');
    expect(refused.map((l) => l.fields?.['line'])).toEqual([
      `${up.address} echo: claims another id: other`,
    ]);
  });
});

describe('the kit request line on the cloud app', () => {
  const SECRET = { cookie: 'better-auth.session_token=s1.sig', authorization: 'Bearer aga_x.jwt' };

  it('one line per request: method, route template, status, ms; never a cookie or Authorization', async () => {
    const { host, lines, texts } = await startWith(docOf('echo'));
    await host.call('/.well-known/agentage-host.json', { headers: SECRET });
    await host.call('/api/echo/x?id=42', { headers: SECRET });
    await host.call('/health');
    const http = lines().filter((l) => l.kind === 'http');
    const keys = ['http.request.method', 'http.route', 'http.response.status_code'];
    const rows = http.map((l) => keys.map((k) => l.fields?.[k]));
    expect(rows).toEqual([
      ['GET', '/.well-known/agentage-host.json', 200],
      ['GET', '/api/{id}/*', 200],
    ]);
    expect(http.every((l) => typeof l.fields?.['agentage.duration_ms'] === 'number')).toBe(true);
    for (const value of [...Object.values(SECRET), 's1.sig', 'aga_x', 'id=42'])
      expect(texts.join('\n')).not.toContain(value);
  });
});
