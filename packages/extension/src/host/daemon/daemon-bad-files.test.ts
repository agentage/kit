import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, tempConfigDir, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { wordLaunch, wordPackage } from '../../test-support/word-launch.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  if (h) await chmod(h.configDir, 0o755);
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

// A broken secrets.json: the parser's own message would quote the secret.
const BROKEN = '{"hosted": {"api-token": sekret-value}}';
const at = (name: string) => join(h!.configDir, name);
const listed = async () => (await h!.call('GET', '/host/extensions')).body as { data: object[] };

const installed = async (files: Record<string, string>) => {
  const configDir = await tempConfigDir();
  const dir = await hostedPackage(NO_STORE_MANIFEST);
  const rows = { extensions: [{ id: 'hosted', source: dir }] };
  await writeFile(join(configDir, 'installation.json'), JSON.stringify(rows));
  for (const [name, text] of Object.entries(files)) await writeFile(join(configDir, name), text);
  h = await startHarness({ configDir });
};

describe('a settings.json or secrets.json that is not JSON, or not rows by id', () => {
  it('at boot: failed with the file named, the secret never quoted, the file kept', async () => {
    await installed({ 'secrets.json': BROKEN });
    const error = 'secrets.json cannot be read (not JSON): fix it; no change is written';
    expect((await listed()).data).toMatchObject([{ id: 'hosted', state: 'failed', error }]);
    expect(JSON.stringify((await h!.call('GET', '/health')).body)).not.toContain('sekret');
    expect(await readFile(at('secrets.json'), 'utf8')).toBe(BROKEN);
  });

  it('PATCH and DELETE are 409 naming the file; the row and the file stay', async () => {
    await installed({ 'secrets.json': '{"hosted": {"api-token": "t"}}' });
    await writeFile(at('settings.json'), '[1, 2]');
    const patch = { settings: { 'echo.prefix': 'x' } };
    expect(await h!.call('PATCH', '/host/extensions/hosted', patch)).toMatchObject({
      status: 409,
      body: { error: { code: 'SETTINGS_UNREADABLE', details: { file: 'settings.json' } } },
    });
    expect(await readFile(at('settings.json'), 'utf8')).toBe('[1, 2]');
    await writeFile(at('settings.json'), '{}');
    await writeFile(at('secrets.json'), BROKEN);
    expect(await h!.call('DELETE', '/host/extensions/hosted')).toMatchObject({
      status: 409,
      body: { error: { code: 'SECRETS_UNREADABLE', details: { reason: 'not JSON' } } },
    });
    expect((await listed()).data).toMatchObject([{ id: 'hosted', state: 'running' }]);
    expect(await readFile(at('secrets.json'), 'utf8')).toBe(BROKEN);
  });
});

describe('a config folder that cannot be written (read-only, full)', () => {
  it('is 503 naming the file and the errno; the child runs on; no tmp file stays', async () => {
    const w = wordLaunch();
    h = await startHarness({ launch: w.launch });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    await chmod(h.configDir, 0o555);
    const res = await h.call('PATCH', '/host/extensions/word', { enabled: false });
    expect(res).toMatchObject({ status: 503, body: { error: { code: 'UNAVAILABLE' } } });
    expect(JSON.stringify(res.body)).toContain('installation.json cannot be written (EACCES)');
    expect((await listed()).data).toMatchObject([{ id: 'word', state: 'running' }]);
    expect((await readdir(h.configDir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('daemon.json and reload.json that are not JSON', () => {
  it('daemon.json is the daemon own file: written anew at start', async () => {
    const configDir = await tempConfigDir();
    await writeFile(join(configDir, 'daemon.json'), '{');
    h = await startHarness({ configDir });
    expect((await h.call('GET', '/host/extensions')).status).toBe(200);
  });

  it('a reload.json of a row is removed at boot; dist is not touched', async () => {
    const configDir = await tempConfigDir();
    const dir = await wordPackage('one');
    const rows = { extensions: [{ id: 'word', source: dir }] };
    await writeFile(join(configDir, 'installation.json'), JSON.stringify(rows));
    await mkdir(join(configDir, 'run', 'word'), { recursive: true });
    await writeFile(join(configDir, 'run', 'word', 'reload.json'), '{');
    h = await startHarness({ configDir, launch: wordLaunch().launch });
    expect(await readdir(join(configDir, 'run', 'word'))).not.toContain('reload.json');
    expect(await readFile(join(dir, 'dist', 'word.txt'), 'utf8')).toBe('one');
  });
});
