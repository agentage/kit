import { readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { HOSTED_MANIFEST, hostedPackage } from '../../test-support/hosted-fixture.js';

let h: Harness;
beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  h = await startHarness({ lockMs: 100 });
  await writeSecrets(h.configDir);
  await h.call('POST', '/host/extensions', { source: await hostedPackage() });
});
afterEach(async () => {
  await h.daemon.stop();
  vi.restoreAllMocks();
});

const FILES = ['installation.json', 'settings.json', 'secrets.json'];
// Each file as JSON; one not there reads as {} (what the daemon reads).
const files = () =>
  Promise.all(
    FILES.map((f) => readFile(join(h.configDir, f), 'utf8').then(JSON.parse, () => ({})))
  );

// Another live process holds the lock of one file: the write of that file fails after lockMs.
const lockedWhile = async <T>(file: string, fn: () => Promise<T>): Promise<T> => {
  const lock = join(h.configDir, `${file}.lock`);
  await writeFile(lock, String(process.ppid));
  try {
    return await fn();
  } finally {
    await rm(lock);
  }
};

const refusal = (file: string) => ({
  status: 503,
  body: {
    error: {
      code: 'UNAVAILABLE',
      message: `${file} is locked by process ${process.ppid}: waited 100 ms`,
    },
  },
});

// Memory, the files and the running child are as before a write that failed.
const unchanged = async (before: string[], pid: unknown) => {
  expect(await files()).toEqual(before);
  expect((await h.call('GET', '/host/extensions')).body).toMatchObject({
    data: [{ id: 'hosted', state: 'running', enabled: true, pid }],
  });
  expect((await h.call('GET', '/api/hosted/echo?msg=hi')).status).toBe(200);
};

const pidNow = async () =>
  ((await h.call('GET', '/host/extensions')).body as { data: { pid?: number }[] }).data[0]?.pid;

describe('a change whose file write fails changes nothing', () => {
  it('PATCH { enabled: false }: the file is locked, the child runs on, enabled stays true', async () => {
    const before = await files();
    const pid = await pidNow();
    const patch = () => h.call('PATCH', '/host/extensions/hosted', { enabled: false });
    expect(await lockedWhile('installation.json', patch)).toMatchObject(
      refusal('installation.json')
    );
    await unchanged(before, pid);
    const settings = { settings: { 'echo.prefix': 'a' } };
    expect(await h.call('PATCH', '/host/extensions/hosted', settings)).toMatchObject({
      body: { data: { state: 'running' } },
    });
  });

  it('PATCH { settings } (the swap path): secrets.json is locked, no file changes, no swap', async () => {
    const before = await files();
    const pid = await pidNow();
    const patch = { settings: { 'echo.prefix': 'hey' }, secrets: { 'api-token': 'new' } };
    const call = () => h.call('PATCH', '/host/extensions/hosted', patch);
    expect(await lockedWhile('secrets.json', call)).toMatchObject(refusal('secrets.json'));
    await unchanged(before, pid);
  });

  it('DELETE: secrets.json is locked, the entry stays listed and running, its rows stay', async () => {
    await h.call('PATCH', '/host/extensions/hosted', { settings: { 'echo.prefix': 'x' } });
    const before = await files();
    const pid = await pidNow();
    const call = () => h.call('DELETE', '/host/extensions/hosted');
    expect(await lockedWhile('secrets.json', call)).toMatchObject(refusal('secrets.json'));
    await unchanged(before, pid);
  });
});

// Taken with wx, so it never overwrites the daemon's own lock while that one is held.
const takeLock = async (file: string) => {
  for (;;) {
    const taken = await writeFile(join(h.configDir, `${file}.lock`), String(process.ppid), {
      flag: 'wx',
    }).then(
      () => true,
      () => false
    );
    if (taken) return;
    await sleep(5);
  }
};

describe('a failed write whose undo fails too', () => {
  it('says so in one warn line and in /health (unsynced, degraded) until a write of that id passes', async () => {
    await h.daemon.stop();
    h = await startHarness({ lockMs: 600, configDir: h.configDir });
    const patch = { settings: { 'echo.prefix': 'hey' } };
    const settled = lockedWhile('secrets.json', async () => {
      const call = h.call('PATCH', '/host/extensions/hosted', {
        ...patch,
        secrets: { 'api-token': 'n' },
      });
      // settings.json is written: lock it, so its undo waits lockMs and fails.
      await vi.waitFor(
        async () =>
          expect(await readFile(join(h.configDir, 'settings.json'), 'utf8')).toContain('hey'),
        { interval: 5 }
      );
      await takeLock('settings.json');
      return call;
    });
    expect(await settled).toMatchObject({ status: 503, body: { error: { code: 'UNAVAILABLE' } } });
    expect((await h.call('GET', '/health')).body).toMatchObject({
      status: 'degraded',
      unsynced: ['hosted'],
    });
    const warned = vi
      .mocked(process.stderr.write)
      .mock.calls.filter(([line]) => String(line).includes('could not be undone'));
    expect(warned).toHaveLength(1);
    await rm(join(h.configDir, 'settings.json.lock'));
    expect(
      await h.call('PATCH', '/host/extensions/hosted', { settings: { 'echo.prefix': 'a' } })
    ).toMatchObject({ status: 200 });
    expect((await h.call('GET', '/health')).body).not.toHaveProperty('unsynced');
  });

  it('a refused start whose put-back fails is marked too', async () => {
    await h.daemon.stop();
    const broken = 'export const create = () => { throw new Error("boom"); };';
    const dirs: Record<string, string> = {
      '1.0.0': await hostedPackage(),
      '2.0.0': await hostedPackage({ ...HOSTED_MANIFEST, version: '2.0.0' }, broken),
    };
    const install = vi.fn(async ({ id, version = '1.0.0' }: { id: string; version?: string }) => ({
      id,
      version,
      dir: dirs[version]!,
    }));
    h = await startHarness({ lockMs: 300, install });
    await writeSecrets(h.configDir);
    await h.call('POST', '/host/extensions', { id: 'hosted' });
    const call = h.call('PATCH', '/host/extensions/hosted', { version: '2.0.0' });
    const file = join(h.configDir, 'installation.json');
    await vi.waitFor(async () => expect(await readFile(file, 'utf8')).toContain('2.0.0'), {
      interval: 5,
    });
    await takeLock('installation.json');
    expect(await call).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', details: { code: 'START_FAILED' } } },
    });
    expect((await h.call('GET', '/health')).body).toMatchObject({ unsynced: ['hosted'] });
    await rm(join(h.configDir, 'installation.json.lock'));
  });
});
