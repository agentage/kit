import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error the build script is plain ESM with no types
import { buildAll, readKitVersion, shellFileOf } from '../../scripts/build.mjs';

const shellFile = shellFileOf as (path: string) => string | null;
let out = '';
beforeAll(async () => {
  out = await (buildAll as (o: string) => Promise<string>)(
    await mkdtemp(join(tmpdir(), 'shell-layout-'))
  );
}, 60_000);
afterAll(() => rm(out, { recursive: true, force: true }));

// L3 bug 1: the daemon serves dist/index.html at / and dist/* at /shell/*.
describe('the dist layout the daemon serves', () => {
  it('every /shell/ URL in index.html (scripts, css, import map) is a file in dist/', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const urls = [...html.matchAll(/["'](\/shell\/[^"']+)["']/g)].map((m) => m[1]!);
    expect(urls).toEqual(
      expect.arrayContaining(['/shell/shell.js', '/shell/shell.css', '/shell/vendor/react.js'])
    );
    for (const url of urls) {
      const rel = shellFile(url);
      expect(rel, url).not.toBeNull();
      expect(existsSync(join(out, rel!)), url).toBe(true);
    }
  });

  it('only /shell/ paths map to files', () => {
    expect(shellFile('/shell/vendor/app.js')).toBe('vendor/app.js');
    expect(shellFile('/probe/shell.js')).toBeNull();
  });
});

// The nav foot label is the kit version that built the shell, never a constant.
describe('the shell version label', () => {
  it('index.html carries the kit package version, not the shell package version', async () => {
    const kit = JSON.parse(
      readFileSync(join(__dirname, '../../../extension/package.json'), 'utf8')
    );
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toContain(`<meta name="agentage-shell" content="${kit.version}"`);
    expect(await (readKitVersion as () => Promise<string>)()).toBe(kit.version);
  });
});
