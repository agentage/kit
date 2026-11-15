import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, tempConfigDir, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
import { createDaemon } from './daemon.js';
import { readJsonFile } from './json-file.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const read = (configDir: string, file: string) => readJsonFile(join(configDir, file), {});

// installation.json names hosted only; settings.json and secrets.json also hold gone.
const configWith = async (installation: string) => {
  const configDir = await tempConfigDir();
  await writeFile(join(configDir, 'installation.json'), installation);
  const rows = (value: object) => json({ hosted: value, gone: value });
  await writeFile(join(configDir, 'settings.json'), rows({ 'echo.prefix': 'x' }));
  await writeFile(join(configDir, 'secrets.json'), rows({ 'api-token': 't' }), { mode: 0o600 });
  return configDir;
};

const ROWS = { hosted: { 'api-token': 't' }, gone: { 'api-token': 't' } };
const bootTwice = async (configDir: string) => {
  for (let boot = 0; boot < 2; boot += 1) {
    h = await startHarness({ configDir });
    await h.daemon.stop();
    h = undefined;
  }
};

// A daemon deletes a settings or secrets row only on a remove of that id, never at a boot.
describe('two boots keep every settings and secrets row', () => {
  it.each([
    ['is not JSON', () => '{"host": "local", "exten', true],
    ['has an id twice', async (s: string) => twice(s), true],
    ['has a row C3 refuses', () => json({ host: 'local', extensions: [{ id: 'Bad' }] }), true],
    ['names only hosted', async (s: string) => one(s), false],
  ])('when installation.json %s', async (_name, text, bad) => {
    const configDir = await configWith(await text(await hostedPackage(NO_STORE_MANIFEST)));
    await bootTwice(configDir);
    expect(await read(configDir, 'secrets.json')).toEqual(ROWS);
    expect(Object.keys(await read(configDir, 'settings.json'))).toEqual(['hosted', 'gone']);
    expect(existsSync(join(configDir, 'installation.json.bad'))).toBe(bad);
  });

  it('when there is no installation.json (a move from cli 0.51 that did not finish)', async () => {
    const configDir = await configWith('{}');
    await rm(join(configDir, 'installation.json'));
    await bootTwice(configDir);
    expect(await read(configDir, 'secrets.json')).toEqual(ROWS);
    expect(Object.keys(await read(configDir, 'settings.json'))).toEqual(['hosted', 'gone']);
  });

  it('when installation.json cannot be read', async () => {
    const configDir = await configWith('{}');
    await rm(join(configDir, 'installation.json'));
    await mkdir(join(configDir, 'installation.json'));
    await bootTwice(configDir);
    expect(await read(configDir, 'secrets.json')).toEqual(ROWS);
  });
});

const one = (source: string) => json({ host: 'local', extensions: [{ id: 'hosted', source }] });
const twice = (source: string) =>
  json({
    host: 'local',
    extensions: [
      { id: 'hosted', source },
      { id: 'hosted', source },
    ],
  });

// The built export: verify builds it (tsc -b) before the tests run.
const HOST = fileURLToPath(new URL('../../../dist/host/index.js', import.meta.url));
const RUN = `const { createDaemon } = await import(process.argv[1]);
await createDaemon({ configDir: process.argv[2], port: 0, version: 't', startedBy: 'test', lockMs: 60000 });`;

describe('a daemon killed in the middle of a remove', () => {
  it('has deleted the secrets of that id first, so a later install never gets them', async () => {
    if (!existsSync(HOST)) throw new Error(`${HOST} is missing: npm run build first`);
    const source = await hostedPackage(NO_STORE_MANIFEST);
    const row = { id: 'hosted', source, enabled: false };
    const configDir = await configWith(json({ host: 'local', extensions: [row] }));
    const daemon = spawn(process.execPath, ['--input-type=module', '-e', RUN, HOST, configDir], {
      stdio: 'ignore',
    });
    try {
      const port = await vi.waitFor(
        async () =>
          JSON.parse(await readFile(join(configDir, 'daemon.json'), 'utf8')).port as number,
        { timeout: 20_000, interval: 50 }
      );
      // The second write of a remove (settings.json) waits for this live holder: the kill comes then.
      await writeFile(join(configDir, 'settings.json.lock'), String(process.ppid));
      void fetch(`http://127.0.0.1:${port}/host/extensions/hosted`, { method: 'DELETE' }).catch(
        () => undefined
      );
      const secrets = () => read(configDir, 'secrets.json');
      await vi.waitFor(async () => expect(await secrets()).toEqual({ gone: ROWS.gone }), {
        timeout: 20_000,
        interval: 20,
      });
    } finally {
      daemon.kill('SIGKILL');
    }
    expect(await read(configDir, 'installation.json')).toMatchObject({ extensions: [row] });
    expect(Object.keys(await read(configDir, 'settings.json'))).toEqual(['hosted', 'gone']);
  }, 60_000);
});

const modeOf = async (configDir: string, file: string) =>
  (await stat(join(configDir, file))).mode & 0o777;

describe('a file the daemon rewrites', () => {
  it('keeps its mode: a 0600 settings.json and installation.json stay 0600', async () => {
    const configDir = await configWith(one(await hostedPackage(NO_STORE_MANIFEST)));
    await chmod(join(configDir, 'settings.json'), 0o600);
    await chmod(join(configDir, 'installation.json'), 0o600);
    h = await startHarness({ configDir });
    const body = { settings: { 'echo.prefix': 'y' }, enabled: true };
    expect((await h.call('PATCH', '/host/extensions/hosted', body)).status).toBe(200);
    expect(await read(configDir, 'settings.json')).toMatchObject({
      hosted: { 'echo.prefix': 'y' },
    });
    expect(await modeOf(configDir, 'settings.json')).toBe(0o600);
    expect(await modeOf(configDir, 'installation.json')).toBe(0o600);
    expect(await modeOf(configDir, 'secrets.json')).toBe(0o600);
  });
});

// Every file of the folder with its content and mtime: a write of any kind changes it.
const snapshot = async (configDir: string) => {
  const names = (await readdir(configDir, { recursive: true })).sort();
  const of = async (name: string) => {
    const at = join(configDir, name);
    const st = await stat(at);
    return [name, st.mtimeMs, st.isFile() ? await readFile(at, 'utf8') : 'dir'];
  };
  return Promise.all(names.map(of));
};

describe('a second daemon on a folder a live daemon owns', () => {
  it('fails with DAEMON_RUNNING and writes nothing in that folder', async () => {
    if (!existsSync(HOST)) throw new Error(`${HOST} is missing: npm run build first`);
    const configDir = await configWith(one(await hostedPackage(NO_STORE_MANIFEST)));
    const args = ['--input-type=module', '-e', RUN, HOST, configDir];
    const daemon = spawn(process.execPath, args, { stdio: 'ignore' });
    try {
      await vi.waitFor(() => readFile(join(configDir, 'daemon.json'), 'utf8'), {
        timeout: 20_000,
        interval: 50,
      });
      await vi.waitFor(async () => {
        const port = (await read(configDir, 'daemon.json')) as { port: number };
        expect((await fetch(`http://127.0.0.1:${port.port}/health`)).status).toBe(200);
      });
      const before = await snapshot(configDir);
      const second = createDaemon({ configDir, port: 0, version: 't', startedBy: 'test' });
      await expect(second).rejects.toMatchObject({ code: 'DAEMON_RUNNING' });
      expect(await snapshot(configDir)).toEqual(before);
    } finally {
      daemon.kill('SIGKILL');
    }
  }, 60_000);
});
