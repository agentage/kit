import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage, NO_STORE_MANIFEST } from '../../test-support/hosted-fixture.js';
import { wordLaunch, wordPackage, type WordLaunch } from '../../test-support/word-launch.js';
import { dataDirOf } from './daemon-files.js';

let h: Harness | undefined;
let w: WordLaunch;
beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  w = wordLaunch();
});
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const SHORT = { backoffMs: [10, 20, 40, 80, 160] };
// Each wait is bounded on its own, well above the backoff, never vi.waitFor's 1 s default.
const WAIT = { timeout: 5_000, interval: 20 };
const rowOf = async (id = 'word') =>
  (
    (await h!.call('GET', '/host/extensions')).body as { data: Record<string, unknown>[] }
  ).data.find((row) => row['id'] === id);
const crashLast = () => w.children.at(-1)!.crash('crash on purpose');

describe('a child that exits (C6)', () => {
  it('restarts until 5 exits in 10 min, then is failed with the last words; others untouched', async () => {
    h = await startHarness({ launch: w.launch, ...SHORT });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    for (let start = 1; start <= 5; start += 1) {
      await vi.waitFor(() => expect(w.children).toHaveLength(start), WAIT);
      crashLast();
    }
    await vi.waitFor(
      async () =>
        expect(await rowOf()).toMatchObject({
          state: 'failed',
          error: 'exited 5 times in 10 min: crash on purpose',
        }),
      WAIT
    );
    await pause(300);
    expect(w.children).toHaveLength(5);
  });

  it('enable after failed is a new start, and the count starts again', async () => {
    h = await startHarness({ launch: w.launch, ...SHORT, crashLimit: 1 });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    crashLast();
    await vi.waitFor(async () => expect(await rowOf()).toMatchObject({ state: 'failed' }), WAIT);
    const enabled = await h.call('PATCH', '/host/extensions/word', { enabled: true });
    expect(enabled).toMatchObject({ status: 200, body: { data: { state: 'running' } } });
    expect(w.children).toHaveLength(2);
  });

  it('a remove during the backoff cancels the restart', async () => {
    h = await startHarness({ launch: w.launch, backoffMs: [200] });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    crashLast();
    await vi.waitFor(async () => expect(await rowOf()).toMatchObject({ state: 'starting' }), WAIT);
    await h.call('DELETE', '/host/extensions/word');
    await pause(400);
    expect(w.children).toHaveLength(1);
  });
});

describe('secrets in the reason of an exit', () => {
  it('every value of 4 or more characters this child was given is *** in the list and /health', async () => {
    h = await startHarness({ launch: w.launch, backoffMs: [60_000] });
    const rows = { word: { 'key-a': 'sekret-value', 'key-b': 'ab' } };
    await writeFile(join(h.configDir, 'secrets.json'), JSON.stringify(rows), { mode: 0o600 });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one') });
    w.children.at(-1)!.crash('token sekret-value refused, ab');
    const error = 'token *** refused, ab: restart in 60000 ms';
    await vi.waitFor(async () => expect(await rowOf()).toMatchObject({ error }), WAIT);
    expect(JSON.stringify((await h.call('GET', '/health')).body)).not.toContain('sekret-value');
  });
});

describe('a new install that does not start (C6)', () => {
  it('is 400 START_FAILED, leaves no row and no data folder; the others answer', async () => {
    h = await startHarness({ launch: w.launch });
    await h.call('POST', '/host/extensions', { source: await wordPackage('one', 'fine') });
    const refused = await h.call('POST', '/host/extensions', {
      source: await wordPackage('throw'),
    });
    expect(refused).toMatchObject({
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: { code: 'START_FAILED', reason: 'fails at start' },
        },
      },
    });
    expect(await rowOf()).toBeUndefined();
    const file = await readFile(join(h.configDir, 'installation.json'), 'utf8');
    expect([file.includes('"word"'), file.includes('"fine"')]).toEqual([false, true]);
    expect(existsSync(dataDirOf(h.configDir, 'word'))).toBe(false);
    expect(existsSync(join(h.configDir, 'run', 'word'))).toBe(false);
    expect(await rowOf('fine')).toMatchObject({ state: 'running' });
  });

  it('keeps the data folder of an id that had one, and its settings and secrets rows', async () => {
    h = await startHarness({ launch: w.launch });
    const data = dataDirOf(h.configDir, 'word');
    await mkdir(data, { recursive: true });
    await writeFile(join(data, 'kept.txt'), 'x');
    await writeSecrets(h.configDir, ['word']);
    await h.call('POST', '/host/extensions', { source: await wordPackage('throw') });
    expect(existsSync(join(data, 'kept.txt'))).toBe(true);
    expect(await readFile(join(h.configDir, 'secrets.json'), 'utf8')).toContain('"word"');
  });

  it('a missing declared secret is kept as failed with "needs secret"; configure starts it', async () => {
    h = await startHarness();
    const source = await hostedPackage(NO_STORE_MANIFEST);
    const added = await h.call('POST', '/host/extensions', { source });
    expect(added).toMatchObject({
      status: 201,
      body: { data: { state: 'failed', error: 'needs secret api-token' } },
    });
    const set = await h.call('PATCH', '/host/extensions/hosted', { secrets: { 'api-token': 't' } });
    expect(set).toMatchObject({ status: 200, body: { data: { state: 'running' } } });
  });
});
