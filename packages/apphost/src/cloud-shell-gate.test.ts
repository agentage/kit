import { afterEach, describe, expect, it } from 'vitest';
import { fakeAuth, SESSION, USER } from './test-support/cloud-host.js';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  OWN,
  startCloud,
  startWithShell,
  type Started,
  upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const ISSUER = { AGENTAGE_ISSUER: 'https://auth.next.agentage.io' };
const PAGE = { cookie: SESSION, origin: OWN, 'sec-fetch-site': 'same-origin' };
const NO_ROWS = { extensions: [], upstreams: [] };
const codeOf = (body: string) => (JSON.parse(body) as { error?: { code?: string } }).error?.code;

describe('a cloud host with no shell key: /shell/session only', () => {
  it('/shell/events and /shell/sign-out are the 404 envelope; the session names no sign-out', async () => {
    host = await startCloud(await cloudEnv(NO_ROWS, ISSUER), { fetcher: fakeAuth().fetcher });
    const events = await host.call('/shell/events');
    const out = await host.call('/shell/sign-out', { method: 'POST', headers: PAGE });
    expect([events.status, codeOf(events.body), out.status, codeOf(out.body)]).toEqual([
      404,
      'NOT_FOUND',
      404,
      'NOT_FOUND',
    ]);
    const session = await host.call('/shell/session', { headers: PAGE });
    expect(JSON.parse(session.body)).toMatchObject({ user: USER, signOut: null });
  });

  it('on a pages host (root) both paths go to the site, as any path that is not reserved', async () => {
    const pages = await upstream(docOf('site', ['pages']));
    const rows = {
      extensions: [{ id: 'site', expose: { pages: 'public' } }],
      upstreams: [{ id: 'site', address: pages.address }],
    };
    host = await startCloud(await cloudEnv(rows));
    expect((await host.call('/shell/events')).status).toBe(200);
    expect((await host.call('/shell/sign-out', { method: 'POST' })).status).toBe(200);
    expect(pages.seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET /shell/events',
      'POST /shell/sign-out',
    ]);
  });

  it('a host with a shell key serves the feed and names the sign-out', async () => {
    host = await startWithShell(NO_ROWS, ISSUER, { fetcher: fakeAuth().fetcher });
    const session = await host.call('/shell/session', { headers: PAGE });
    expect(JSON.parse(session.body)).toMatchObject({ user: USER, signOut: '/shell/sign-out' });
    const head = await host.call('/shell/events', { method: 'HEAD' });
    expect([head.status, head.headers['content-type']]).toEqual([200, 'text/event-stream']);
  });
});
