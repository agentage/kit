import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startHarness,
  tempConfigDir,
  writeSecrets,
  type Harness,
} from '../../test-support/daemon-harness.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { freePort } from '../../test-support/processes.js';
import { type Launch } from './child.js';
import { startDaemon, type Daemon } from './daemon.js';
import { readJsonFile } from './json-file.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
let booted: Daemon | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  await booted?.stop();
  h = booted = undefined;
  vi.restoreAllMocks();
});

const doc = () => readJsonFile(join(h!.configDir, 'installation.json'), {});

describe('a daemon file locked by another live process', () => {
  it('PATCH waits lockMs, is 503 naming the pid, and the old child runs on', async () => {
    h = await startHarness({ lockMs: 100 });
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    const lock = join(h.configDir, 'installation.json.lock');
    await writeFile(lock, String(process.ppid));
    const refused = await h.call('PATCH', '/host/extensions/hosted', {
      settings: { 'echo.prefix': 'hey' },
    });
    await rm(lock);
    expect(refused).toMatchObject({
      status: 503,
      body: {
        error: {
          code: 'UNAVAILABLE',
          message: `installation.json is locked by process ${process.ppid}: waited 100 ms`,
        },
      },
    });
    expect(await h.call('GET', '/api/hosted/echo?msg=hi')).toMatchObject({
      status: 200,
      body: { data: { msg: 'hi' } },
    });
    expect(await readJsonFile(join(h.configDir, 'settings.json'), {})).toEqual({});
  });
});

describe('a slow installer at boot', () => {
  it('fails only its own entry after installMs, with the reason; the others run; /health answers meanwhile', async () => {
    const configDir = await tempConfigDir();
    const dir = await hostedPackage();
    const other = await hostedPackage({
      ...NO_STORE_MANIFEST,
      agentage: { ...NO_STORE_MANIFEST.agentage, id: 'other' },
    });
    const extensions = [
      { id: 'slow', version: '1.0.0' },
      { id: 'hosted', source: dir },
      { id: 'other', version: '1.0.0' },
    ];
    await writeFile(join(configDir, 'installation.json'), json({ host: 'local', extensions }));
    await writeSecrets(configDir, ['hosted', 'other']);
    const signals: AbortSignal[] = [];
    const install = vi.fn<Installer>(async ({ id, signal }) => {
      if (id === 'other') return { id, version: '1.0.0', dir: other };
      signals.push(signal!);
      return new Promise(() => undefined);
    });
    const port = await freePort();
    const opts = { configDir, port, version: 't', startedBy: 'test', install, installMs: 1_500 };
    const starting = startDaemon(opts, inProcessLaunch);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const during = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    expect(during).toMatchObject({
      extensions: [
        { id: 'slow', state: 'starting' },
        { id: 'hosted', state: 'running' },
        { id: 'other' },
      ],
    });
    booted = await starting;
    const list = (await (await fetch(`http://127.0.0.1:${port}/host/extensions`)).json()) as {
      data: object[];
    };
    expect(list.data).toMatchObject([
      { id: 'slow', state: 'failed', error: 'the installer did not answer in 1500 ms' },
      { id: 'hosted', state: 'running' },
      { id: 'other', state: 'running' },
    ]);
    expect(signals[0]?.aborted).toBe(true);
    const values = await fetch(`http://127.0.0.1:${port}/host/extensions/slow`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { a: 1 } }),
    });
    expect([values.status, await values.json()]).toMatchObject([
      400,
      { error: { message: 'slow has no package yet: install it first' } },
    ]);
  });

  it('an installer that answers in time sees no abort', async () => {
    let seen: AbortSignal | undefined;
    const dir = await hostedPackage(NO_STORE_MANIFEST);
    const install = vi.fn<Installer>(async ({ signal }) => {
      seen = signal;
      return { id: 'hosted', version: '1.0.0', dir };
    });
    h = await startHarness({ install, installMs: 5_000 });
    await writeSecrets(h.configDir, ['hosted']);
    await h.call('POST', '/host/extensions', { id: 'hosted' });
    expect(seen?.aborted).toBe(false);
  });

  it('POST { id } past installMs is 504 TIMEOUT, records nothing, and stays pending until the installer ends', async () => {
    let finish = (_err: Error) => undefined as void;
    const install = vi.fn<Installer>(() => new Promise((_ok, no) => (finish = no)));
    h = await startHarness({ install, installMs: 1_000 });
    const posted = h.call('POST', '/host/extensions', { id: 'probe' });
    await vi.waitFor(() => expect(install).toHaveBeenCalled());
    expect((await h.call('GET', '/health')).body).toMatchObject({
      pending: [{ op: 'install', id: 'probe', since: expect.any(String) }],
    });
    expect(await posted).toMatchObject({
      status: 504,
      body: { error: { code: 'TIMEOUT', message: 'the installer did not answer in 1000 ms' } },
    });
    const timedOut = { op: 'install', id: 'probe', since: expect.any(String), timedOut: true };
    expect((await h.call('GET', '/health')).body).toMatchObject({ pending: [timedOut] });
    expect(await h.call('POST', '/host/extensions', { id: 'probe' })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFLICT', details: timedOut } },
    });
    expect(install).toHaveBeenCalledTimes(1);
    finish(new Error('npm gave up'));
    await vi.waitFor(async () =>
      expect((await h!.call('GET', '/health')).body).not.toHaveProperty('pending')
    );
    expect((await h.call('GET', '/host/extensions')).body).toMatchObject({ data: [] });
    expect(await doc()).toEqual({});
  });
});

// A child that reports a port nobody listens on: its /health cannot be reached.
const unreachable: Launch = async () => ({
  port: await freePort(),
  pid: 1,
  exited: new Promise<never>(() => undefined),
  stop: async () => undefined,
});

describe('a new child whose /health cannot be reached', () => {
  it('fails with the cause, not with a timeout', async () => {
    h = await startHarness({ launch: unreachable });
    const added = await h.call('POST', '/host/extensions', { source: await hostedPackage() });
    expect(added.body).toMatchObject({
      data: { state: 'failed', error: 'health could not be reached (ECONNREFUSED)' },
    });
  });
});
