import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, tempConfigDir, type Harness } from './test-support/daemon-harness.js';
import { json } from '../../extension/src/test-support/packages.js';
import { wordLaunch, wordPackage, type WordLaunch } from './test-support/word-launch.js';

let h: Harness | undefined;
let w: WordLaunch;
let dir: string;
const locked: string[] = [];
beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  w = wordLaunch();
  dir = await wordPackage('one');
});
afterEach(async () => {
  for (const path of locked.splice(0)) await chmod(path, 0o755).catch(() => undefined);
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const put = async (folder: string, file: string, text: string) => {
  await mkdir(dirname(join(dir, folder, file)), { recursive: true });
  await writeFile(join(dir, folder, file), text);
};
const at = (folder: string, file = 'word.txt') => readFile(join(dir, folder, file), 'utf8');
const word = async () => {
  const res = await fetch(`http://127.0.0.1:${h!.daemon.port}/api/word/x`);
  return ((await res.json()) as { data: { word: string } }).data.word;
};
const reload = () => h!.call('POST', '/host/extensions/word/reload', {});
const linked = async () => {
  h = await startHarness({ launch: w.launch });
  await h.call('POST', '/host/extensions', { source: dir });
};

describe('reload: dist.next is the watcher tree and stays', () => {
  it('three reloads in a row with one file changed between them: each is whole and live', async () => {
    await linked();
    await put('dist.next', 'word.txt', 'two');
    await put('dist.next', 'other.js', 'kept');
    for (const next of ['two', 'three', 'four']) {
      await put('dist.next', 'word.txt', next);
      expect(await reload()).toMatchObject({ body: { data: { reloaded: true } } });
      expect([await word(), await at('dist', 'other.js'), await at('dist.next')]).toEqual([
        next,
        'kept',
        next,
      ]);
    }
  });

  it('a build refused at start: the copy goes, dist.next is untouched, the last good runs', async () => {
    await linked();
    await put('dist.next', 'word.txt', 'throw');
    expect(await reload()).toMatchObject({ body: { data: { reloaded: false } } });
    expect([await word(), await at('dist'), await at('dist.next')]).toEqual([
      'one',
      'one',
      'throw',
    ]);
  });

  it('a copy that fails (EACCES) is refused with the reason; the last good build answers, no 500', async () => {
    await linked();
    await put('dist.next', 'word.txt', 'two');
    await chmod(join(dir, 'dist.next', 'word.txt'), 0o000);
    locked.push(join(dir, 'dist.next', 'word.txt'));
    const res = await reload();
    if (process.getuid?.() === 0) return;
    expect(res).toMatchObject({
      status: 200,
      body: { data: { reloaded: false, state: 'running' } },
    });
    expect((res.body as { data: { refused: string } }).data.refused).toMatch(/EACCES/);
    expect([await word(), await at('dist')]).toEqual(['one', 'one']);
  });

  it('a cleanup that fails after the new child is healthy is a success with one child', async () => {
    await linked();
    await put('dist', 'stuck/file.txt', 'x');
    await chmod(join(dir, 'dist', 'stuck'), 0o500);
    locked.push(join(dir, 'dist.prev', 'stuck'));
    await put('dist.next', 'word.txt', 'two');
    expect(await reload()).toMatchObject({ body: { data: { reloaded: true, pid: 1001 } } });
    expect([await word(), w.children.length]).toEqual(['two', 2]);
    if (process.getuid?.() !== 0)
      expect(existsSync(join(dir, 'dist.prev')), 'the cleanup failed').toBe(true);
  });

  it('is refused like every change while installation.json cannot be read', async () => {
    await linked();
    await writeFile(join(h!.configDir, 'installation.json'), 'not json');
    expect(await reload()).toMatchObject({
      status: 409,
      body: { error: { code: 'INSTALLATION_UNREADABLE' } },
    });
  });
});

describe('boot repair of a cut reload (the marker)', () => {
  const bootWith = async (markedDir = dir) => {
    const configDir = await tempConfigDir();
    const extensions = [{ id: 'word', source: dir }];
    await writeFile(join(configDir, 'installation.json'), json({ host: 'local', extensions }));
    await mkdir(join(configDir, 'run', 'word'), { recursive: true });
    const marker = join(configDir, 'run', 'word', 'reload.json');
    await writeFile(marker, json({ id: 'word', dir: markedDir, complete: false }));
    h = await startHarness({ configDir, launch: w.launch });
    return marker;
  };

  it('a crash during the copy: the partial dist goes, dist.prev comes back', async () => {
    await put('dist.prev', 'word.txt', 'one');
    await put('dist', 'word.txt', 'throw');
    const marker = await bootWith();
    expect([await word(), await at('dist'), existsSync(marker)]).toEqual(['one', 'one', false]);
  });

  it('no dist.prev: a user build in dist is never replaced; the marker goes', async () => {
    await put('dist', 'word.txt', 'user build');
    const marker = await bootWith();
    expect([await word(), existsSync(marker)]).toEqual(['user build', false]);
  });

  it('a marker of another folder touches nothing', async () => {
    await put('dist.prev', 'word.txt', 'old');
    await bootWith('/elsewhere');
    expect([await word(), await at('dist.prev')]).toEqual(['one', 'old']);
  });

  it('a remove of the id deletes its marker', async () => {
    const marker = await bootWith('/elsewhere');
    await writeFile(marker, json({ id: 'word', dir }));
    await h!.call('DELETE', '/host/extensions/word');
    expect(existsSync(marker)).toBe(false);
  });
});
