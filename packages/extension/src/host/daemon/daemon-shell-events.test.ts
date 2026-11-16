import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { wordLaunch } from '../../test-support/word-launch.js';
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

describe('/shell/session (S1.2.1 row 7, K9)', () => {
  const TOKEN = 'secret-access-token-value';

  it('the user of auth.json, never a token; a bad or absent file reads signed out', async () => {
    h = await startHarness();
    const session = async () => (await fetch(at('/shell/session'))).text();
    expect(JSON.parse(await session())).toEqual({ user: null, host: 'local' });
    const auth = {
      siteFqdn: 'x',
      clientId: 'c',
      tokens: { accessToken: TOKEN, refreshToken: TOKEN },
      user: { id: 'u1', email: 'a@b.c', hidden: TOKEN },
    };
    await writeFile(join(h.configDir, 'auth.json'), json(auth));
    const text = await session();
    expect(JSON.parse(text)).toEqual({ user: { id: 'u1', email: 'a@b.c' }, host: 'local' });
    expect(text).not.toContain(TOKEN);
    await writeFile(join(h.configDir, 'auth.json'), '{not json');
    expect(JSON.parse(await session())).toEqual({ user: null, host: 'local' });
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
