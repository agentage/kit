import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, tempConfigDir, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { json } from '../../test-support/packages.js';
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

describe('settings and secrets rows of an id installation.json does not name', () => {
  it('are deleted at boot; the other rows stay; secrets.json stays 0600', async () => {
    const source = await hostedPackage(NO_STORE_MANIFEST);
    const configDir = await configWith(
      json({ host: 'local', extensions: [{ id: 'hosted', source }] })
    );
    h = await startHarness({ configDir });
    expect(await read(configDir, 'settings.json')).toEqual({ hosted: { 'echo.prefix': 'x' } });
    expect(await read(configDir, 'secrets.json')).toEqual({ hosted: { 'api-token': 't' } });
    expect((await stat(join(configDir, 'secrets.json'))).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['not JSON', '{"host": "local", "exten'],
    ['with a row C3 refuses', json({ host: 'local', extensions: [{ id: 'Bad' }] })],
  ])('stay when installation.json is %s', async (_name, text) => {
    const configDir = await configWith(text);
    h = await startHarness({ configDir });
    expect(Object.keys(await read(configDir, 'secrets.json'))).toEqual(['hosted', 'gone']);
  });

  it('stay when installation.json cannot be read', async () => {
    const configDir = await configWith('{}');
    await rm(join(configDir, 'installation.json'));
    await mkdir(join(configDir, 'installation.json'));
    h = await startHarness({ configDir });
    expect(Object.keys(await read(configDir, 'secrets.json'))).toEqual(['hosted', 'gone']);
  });
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
      await vi.waitFor(async () => expect(await read(configDir, 'secrets.json')).toEqual({}), {
        timeout: 20_000,
        interval: 20,
      });
    } finally {
      daemon.kill('SIGKILL');
    }
    expect(await read(configDir, 'installation.json')).toMatchObject({ extensions: [row] });
    expect(await read(configDir, 'settings.json')).toEqual({ hosted: { 'echo.prefix': 'x' } });
  }, 60_000);
});
