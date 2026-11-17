import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test-support/packages.js';
import { kitShellDir } from './shell-routes.js';

describe('the kit carries the shell (dist/shell)', () => {
  it('dist/host/daemon finds dist/shell when it has a package.json; src has none', async () => {
    const dist = await tempDir('kit-dist-');
    const from = pathToFileURL(join(dist, 'host/daemon/daemon.js')).href;
    expect(kitShellDir(from)).toBeUndefined();
    await mkdir(join(dist, 'shell'), { recursive: true });
    await writeFile(join(dist, 'shell/package.json'), '{}');
    expect(kitShellDir(from)).toBe(join(dist, 'shell'));
    expect(kitShellDir()).toBeUndefined();
  });
});
