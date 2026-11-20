import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_REASON } from './cloud-discovery.js';
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
  const kit = cloudLog('0.0.0', (text) => texts.push(text));
  // Every call of the request line, before the logs package drops a /health row.
  const routes: string[] = [];
  const log = {
    ...kit,
    http: (row: Parameters<typeof kit.http>[0]) => (routes.push(row.route), kit.http(row)),
  };
  const rows = { extensions: [{ id: 'echo', expose: { api: 'public' } }], upstreams: [] };
  const env = await cloudEnv({ ...rows, upstreams: [{ id: 'echo', address: up.address }] });
  host = await startCloud(env, { log });
  const lines = () => texts.map((t) => JSON.parse(t) as Line);
  return { up, host, lines, texts, routes };
};

describe('a refused upstream document is one log line (the stub router did the same)', () => {
  it('names the upstream and the row id, also for a document with no id; once, not per read', async () => {
    const { up, host, lines } = await startWith({ not: 'a document' });
    await host.refresh();
    const refused = lines().filter((l) => l.msg === 'document refused');
    expect(refused).toHaveLength(1);
    expect(String(refused[0]?.fields?.['line'])).toMatch(`${up.address} echo: invalid`);
  });

  it('a document of thousands of junk keys: the first issue only, at most MAX_REASON characters', async () => {
    const junk = Object.fromEntries(
      Array.from({ length: 3000 }, (_, i) => [`junk_key_${i}`, 'x'.repeat(40)])
    );
    const doc = { ...docOf('echo'), serves: undefined };
    const { up, lines } = await startWith({ ...doc, ...junk });
    const [line] = lines()
      .filter((l) => l.msg === 'document refused')
      .map((l) => String(l.fields?.['line']));
    const reason = String(line).slice(`${up.address} echo: `.length);
    expect(line).toMatch(`${up.address} echo: invalid: `);
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON);
    expect(reason).not.toContain('; ');
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
    const { host, lines, texts, routes } = await startWith(docOf('echo'));
    await host.call('/.well-known/agentage-host.json', { headers: SECRET });
    await host.call('/api/echo/x?id=42', { headers: SECRET });
    await host.call('/health');
    // A call after /health: its line comes after the finish of /health, so none was missed.
    await host.call('/.well-known/agentage-host.json');
    await vi.waitFor(() => expect(routes.length).toBeGreaterThanOrEqual(3));
    expect(routes).not.toContain('/health');
    const http = lines()
      .filter((l) => l.kind === 'http')
      .slice(0, 2);
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
