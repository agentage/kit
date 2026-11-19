import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { json, tempDir, tempPackage } from '../../extension/src/test-support/packages.js';
import { SHELL_PACKAGE, shellPackageDir } from './shell-package.js';
import { readShell } from './shell-routes.js';
import { startHarness } from './test-support/daemon-harness.js';

const own = JSON.parse(
  readFileSync(new URL('../../shell-dashboard/package.json', import.meta.url), 'utf8')
) as { version: string };

describe('the shell package the program carries (J.4.5 row 1)', () => {
  it('resolves @agentage/shell-dashboard; its version is the package version, never the kit', async () => {
    const dir = shellPackageDir();
    expect(dir).toBeDefined();
    expect(await readShell(dir as string)).toEqual({
      dir,
      package: SHELL_PACKAGE,
      version: own.version,
    });
  });

  it('a program with no shell package installed: undefined, not a throw', async () => {
    const from = pathToFileURL(join(await tempDir(), 'main.js')).href;
    expect(shellPackageDir(from)).toBeUndefined();
  });

  it('a package.json with no name or version is not a shell package', async () => {
    const dir = await tempPackage({ 'package.json': json({ name: SHELL_PACKAGE }) });
    await expect(readShell(dir)).rejects.toThrow('not a shell package');
  });
});

describe('the daemon serves the same package by default', () => {
  it('no shellDir option: the host document names @agentage/shell-dashboard at its own version', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const h = await startHarness({ shellDir: undefined });
    try {
      const at = `http://127.0.0.1:${h.daemon.port}/.well-known/agentage-host.json`;
      const doc = (await (await fetch(at)).json()) as { shell?: unknown };
      expect(doc.shell).toEqual({ package: SHELL_PACKAGE, version: own.version });
    } finally {
      await h.daemon.stop();
      vi.restoreAllMocks();
    }
  });
});
