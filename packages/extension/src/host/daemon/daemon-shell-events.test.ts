import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { wordLaunch } from '../../test-support/word-launch.js';
import { fakeIssuer, signedInAuth } from '../../test-support/fake-issuer.js';
import { json } from '../../test-support/packages.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const APP_MANIFEST = {
  ...NO_STORE_MANIFEST,
  agentage: { ...NO_STORE_MANIFEST.agentage, parts: { api: true, app: true }, app: { title: 'H' } },
};

const build = async (dir: string, hash: string) => {
  await mkdir(join(dir, 'dist/app'), { recursive: true });
  const files = { entry: `app-${hash}.js`, css: `app-${hash}.css` };
  await writeFile(join(dir, 'dist/app/app.json'), json(files));
};

const at = (path: string) => `http://127.0.0.1:${h!.daemon.port}${path}`;

// The events of one open stream, as the shell reads them.
const listen = async () => {
  const res = await fetch(at('/shell/events'));
  const reader = res.body!.getReader();
  let text = '';
  const until = async (needle: string) => {
    while (!text.includes(needle)) text += new TextDecoder().decode((await reader.read()).value);
    return text;
  };
  return { res, until, events: () => [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)] };
};

describe('/shell/events (S1.2.3 rows 1 to 4, K7)', () => {
  it('extensions after install, disable, enable and remove; app after an app reload', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir);
    const stream = await listen();
    expect(stream.res.headers.get('content-type')).toBe('text/event-stream');
    const dir = await hostedPackage(APP_MANIFEST);
    await build(dir, 'aaaaaaaaaa');
    await h.call('POST', '/host/extensions', { source: dir });
    await build(dir, 'bbbbbbbbbb');
    const reload = await h.call('POST', '/host/extensions/hosted/reload', { part: 'app' });
    expect(reload.body).toMatchObject({ data: { id: 'hosted', reloaded: true, part: 'app' } });
    await h.call('PATCH', '/host/extensions/hosted', { enabled: false });
    await h.call('PATCH', '/host/extensions/hosted', { enabled: true });
    await h.call('DELETE', '/host/extensions/hosted');
    await stream.until('"op":"remove"');
    expect(stream.events().map(([, event, data]) => [event, JSON.parse(data ?? '')])).toEqual([
      ['extensions', { op: 'install' }],
      [
        'app',
        {
          id: 'hosted',
          entry: '/app/hosted/app-bbbbbbbbbb.js',
          css: '/app/hosted/app-bbbbbbbbbb.css',
        },
      ],
      ['extensions', { op: 'update', id: 'hosted' }],
      ['extensions', { op: 'update', id: 'hosted' }],
      ['extensions', { op: 'remove', id: 'hosted' }],
    ]);
  });

  it('an app reload keeps the child; one with no built app is 400; the stop ends the stream', async () => {
    h = await startHarness();
    await writeSecrets(h.configDir);
    const dir = await hostedPackage(APP_MANIFEST);
    await h.call('POST', '/host/extensions', { source: dir });
    const before = (await h.call('GET', '/host/extensions')).body;
    const refused = await h.call('POST', '/host/extensions/hosted/reload', { part: 'app' });
    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    await build(dir, 'cccccccccc');
    expect((await h.call('POST', '/host/extensions/hosted/reload', { part: 'app' })).status).toBe(
      200
    );
    expect((await h.call('GET', '/host/extensions')).body).toEqual(before);
    const stream = await listen();
    await h.daemon.stop();
    await expect(stream.until('never')).rejects.toThrow();
    h = undefined;
  });
});

describe('/shell/session (S1.2.1 row 7, K9): the user the children run as', () => {
  const session = async () => (await fetch(at('/shell/session'))).text();

  it('the issuer-checked user with the email of auth.json, never a token; else signed out', async () => {
    const issuer = await fakeIssuer({ 'opaque-alice': 'u_alice' });
    try {
      h = await startHarness({ userPollMs: 20 });
      const host = { kind: 'local' };
      const out = { host, signIn: '/shell/sign-in', signOut: null, user: null };
      expect(JSON.parse(await session())).toEqual(out);
      const user = { id: 'ignored', email: 'a@b.c', name: 'Not Sent', hidden: 'opaque-alice' };
      await writeFile(
        join(h.configDir, 'auth.json'),
        signedInAuth(issuer.issuer, 'opaque-alice', { user })
      );
      await vi.waitFor(async () => expect(JSON.parse(await session()).user).not.toBeNull(), {
        timeout: 5000,
      });
      const text = await session();
      expect(JSON.parse(text)).toEqual({
        host,
        signIn: null,
        signOut: null,
        user: { id: 'u_alice', email: 'a@b.c' },
      });
      expect(text).not.toContain('opaque-alice');
      // The same file with no issuer is no user (cli-user.ts), not the user field it holds.
      await writeFile(
        join(h.configDir, 'auth.json'),
        json({ tokens: { accessToken: 'opaque-alice' }, user })
      );
      await vi.waitFor(async () => expect(JSON.parse(await session())).toEqual(out), {
        timeout: 5000,
      });
    } finally {
      await issuer.close();
    }
  });

  it('the Sign in link names a fixed page that says to run agentage setup, no script', async () => {
    h = await startHarness();
    const res = await fetch(at('/shell/sign-in'), { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'"
    );
    const html = await res.text();
    expect(html).toContain('<code>agentage setup</code>');
    expect(html).not.toContain('<script');
    const query = await fetch(at('/shell/sign-in?next=https://evil.test'));
    expect(await query.text(), 'a query changes nothing').toBe(html);
  });
});

describe('/shell/events session: a sign-in or sign-out reaches an open page', () => {
  it('sends session when auth.json gains and loses a user, with no reload', async () => {
    const issuer = await fakeIssuer({ 'opaque-alice': 'u_alice' });
    try {
      h = await startHarness({ userPollMs: 20 });
      const stream = await listen();
      const file = join(h.configDir, 'auth.json');
      await writeFile(file, signedInAuth(issuer.issuer, 'opaque-alice'));
      await stream.until('{"signedIn":true}');
      await writeFile(file, json({}));
      await stream.until('{"signedIn":false}');
      expect(stream.events().map((m) => m[1])).toEqual(['session', 'session']);
    } finally {
      await issuer.close();
    }
  });
});

describe('a crashed child keeps its nav row (S1.2.3 row 3)', () => {
  it('discovery lists the failed row with its state; a failed row with no app is not listed', async () => {
    const w = wordLaunch();
    h = await startHarness({ launch: w.launch, backoffMs: [10], crashLimit: 1 });
    await writeSecrets(h.configDir);
    const dir = await hostedPackage(APP_MANIFEST);
    await writeFile(join(dir, 'dist/word.txt'), 'x');
    await build(dir, '0123456789');
    await h.call('POST', '/host/extensions', { source: dir });
    const rows = async () =>
      (
        (await (await fetch(at('/.well-known/agentage-host.json'))).json()) as never as {
          extensions: { id: string; state: string; app?: unknown }[];
        }
      ).extensions;
    expect(await rows()).toMatchObject([{ id: 'hosted', state: 'running' }]);
    w.children.at(-1)!.crash('boom');
    await vi.waitFor(async () =>
      expect(await rows()).toMatchObject([{ id: 'hosted', state: 'failed', app: { title: 'H' } }])
    );
    expect((await fetch(at('/app/hosted/app.json'))).status).toBe(200);
  });
});
