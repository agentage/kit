import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, writeSecrets } from './test-support/daemon-harness.js';
import { inProcessLaunch } from './test-support/in-process-launch.js';
import {
  hostedPackage,
  NO_STORE_MANIFEST,
} from '../../extension/src/test-support/hosted-fixture.js';
import { type Child, type Launch } from './child.js';
import { type Installer } from './supervisor.js';

beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(() => void vi.restoreAllMocks());

const other = { ...NO_STORE_MANIFEST, agentage: { ...NO_STORE_MANIFEST.agentage, id: 'slow' } };

describe('a daemon that stops while changes wait', () => {
  it('starts no child for a change in flight or queued; the queued one writes nothing', async () => {
    const dir = await hostedPackage(other);
    let release = () => undefined as void;
    const install = vi.fn<Installer>(async ({ id }) => {
      await new Promise<void>((resolve) => (release = resolve));
      return { id, version: '1.0.0', dir };
    });
    const launch = vi.fn<Launch>(inProcessLaunch);
    const h = await startHarness({ install, launch });
    await writeSecrets(h.configDir, ['hosted', 'slow']);
    await h.call('POST', '/host/extensions', { source: await hostedPackage(NO_STORE_MANIFEST) });
    void h.call('POST', '/host/extensions', { id: 'slow' }).catch(() => undefined);
    const patch = { settings: { 'echo.prefix': 'hey' } };
    void h.call('PATCH', '/host/extensions/hosted', patch).catch(() => undefined);
    await vi.waitFor(() => expect(install).toHaveBeenCalled());
    await h.daemon.stop();
    release();
    const file = join(h.configDir, 'installation.json');
    await vi.waitFor(async () => expect(await readFile(file, 'utf8')).toContain('slow'));
    // A negative check: no event says "no launch came", so a fixed wait gives one the time to.
    await pause(300);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(await readFile(join(h.configDir, 'settings.json'), 'utf8').catch(() => '')).toBe('');
  });

  it('stops a child whose start was in flight when stop began', async () => {
    const children: Child[] = [];
    const exits: Promise<unknown>[] = [];
    let entered = false;
    let go = () => undefined as void;
    const slow: Launch = async (spec) => {
      entered = true;
      await new Promise<void>((resolve) => (go = resolve));
      const child = await inProcessLaunch(spec);
      children.push(child);
      exits.push(child.exited);
      return child;
    };
    const h = await startHarness({ launch: slow });
    await writeSecrets(h.configDir);
    const source = await hostedPackage(NO_STORE_MANIFEST);
    void h.call('POST', '/host/extensions', { source }).catch(() => undefined);
    await vi.waitFor(() => expect(entered).toBe(true));
    const stopped = h.daemon.stop();
    go();
    await stopped;
    expect(children).toHaveLength(1);
    let settled = false;
    void Promise.all(exits).then(() => (settled = true));
    await pause(0);
    expect(settled).toBe(true);
  });
});
