import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from './test-support/daemon-harness.js';
import { wordLaunch, wordPackage, type WordLaunch } from './test-support/word-launch.js';

let h: Harness | undefined;
let w: WordLaunch;
let dir: string;
beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  w = wordLaunch();
  dir = await wordPackage('one');
});
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const linked = async (launch = w.launch) => {
  h = await startHarness({ launch });
  await h.call('POST', '/host/extensions', { source: dir });
};
const word = async () => {
  const res = await fetch(`http://127.0.0.1:${h!.daemon.port}/api/word/x`);
  return ((await res.json()) as { data: { word: string } }).data.word;
};
const nextBuild = async (text: string) => {
  await mkdir(join(dir, 'dist.next'), { recursive: true });
  await writeFile(join(dir, 'dist.next', 'word.txt'), text);
};
const reload = (id = 'word', body: unknown = {}) =>
  h!.call('POST', `/host/extensions/${id}/reload`, body);
const rowOf = async () =>
  ((await h!.call('GET', '/host/extensions')).body as { data: Record<string, unknown>[] }).data[0];
const at = (folder: string) => readFile(join(dir, folder, 'word.txt'), 'utf8');
const marker = () => existsSync(join(h!.configDir, 'run', 'word', 'reload.json'));

describe('POST /host/extensions/{id}/reload (D14)', () => {
  it('swaps dist.next in, starts it healthy, answers reloaded: true with the new pid', async () => {
    await linked();
    await nextBuild('two');
    const res = await reload();
    expect(res).toMatchObject({
      status: 200,
      body: { data: { id: 'word', version: '1.0.0', state: 'running', pid: 1001, reloaded: true } },
    });
    expect(await word()).toBe('two');
    expect([await at('dist'), existsSync(join(dir, 'dist.prev')), marker()]).toEqual([
      'two',
      false,
      false,
    ]);
  });

  it('with no dist.next restarts on the current dist', async () => {
    await linked();
    expect(await reload()).toMatchObject({ body: { data: { pid: 1001, reloaded: true } } });
    expect(await word()).toBe('one');
  });

  it('a build that fails at start is refused: the last good build runs, the bad one is in dist.next', async () => {
    await linked();
    await nextBuild('throw');
    const res = await reload();
    expect(res).toMatchObject({
      status: 200,
      body: { data: { state: 'running', reloaded: false, refused: 'fails at start' } },
    });
    expect([await word(), await at('dist'), await at('dist.next'), marker()]).toEqual([
      'one',
      'one',
      'throw',
      false,
    ]);
  });

  it('stops the old child and waits for its exit before the new one starts; no exit is a crash', async () => {
    const slow = wordLaunch(150);
    await linked(slow.launch);
    await nextBuild('two');
    await reload();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(slow.events).toEqual(['start 1000', 'exit 1000', 'start 1001']);
  });

  it('a reload exit is not a crash exit, and a reload resets the count', async () => {
    h = await startHarness({ launch: w.launch, backoffMs: [5_000, 9_000], crashLimit: 2 });
    await h.call('POST', '/host/extensions', { source: dir });
    w.children.at(-1)!.crash();
    await vi.waitFor(async () => expect(await rowOf()).toMatchObject({ state: 'starting' }));
    for (let i = 0; i < 5; i += 1) await reload();
    w.children.at(-1)!.crash('after reloads');
    await vi.waitFor(async () =>
      expect(await rowOf()).toMatchObject({
        state: 'starting',
        error: 'after reloads: restart in 5000 ms',
      })
    );
  });

  it('two reloads at once run one after the other, never interleaved', async () => {
    const slow = wordLaunch(100);
    await linked(slow.launch);
    const both = await Promise.all([reload(), reload()]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(slow.events).toEqual([
      'start 1000',
      'exit 1000',
      'start 1001',
      'exit 1001',
      'start 1002',
    ]);
  });

  it('loses no request sent during reloads: each waits at the gate', async () => {
    const slow = wordLaunch(50);
    await linked(slow.launch);
    const sent = Array.from({ length: 60 }, (_, i) =>
      new Promise((resolve) => setTimeout(resolve, i * 5)).then(() =>
        fetch(`http://127.0.0.1:${h!.daemon.port}/api/word/x`).then((r) => r.status)
      )
    );
    await Promise.all([reload(), reload(), reload()]);
    expect(new Set(await Promise.all(sent))).toEqual(new Set([200]));
  });

  it('refuses a market row (400), a disabled row (409), an unknown id (404), a body with fields (400)', async () => {
    const install = async ({ id }: { id: string }) => ({ id, version: '1.0.0', dir });
    h = await startHarness({ launch: w.launch, install });
    await h.call('POST', '/host/extensions', { id: 'word' });
    expect(await reload()).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR' } },
    });
    await h.call('DELETE', '/host/extensions/word');
    await h.call('POST', '/host/extensions', { source: dir, enabled: false });
    expect(await reload()).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
    expect(await reload('ghost')).toMatchObject({ status: 404 });
    await h.call('PATCH', '/host/extensions/word', { enabled: true });
    expect(await reload('word', { force: true })).toMatchObject({ status: 400 });
  });
});
