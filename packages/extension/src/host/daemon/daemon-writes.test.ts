import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage } from '../../test-support/hosted-fixture.js';

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
