import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { hostedPackage } from '../../test-support/hosted-fixture.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const BAD = ['./x', '/tmp/x', 'https://evil.example/x.tgz', '1.0.0 --x', '--registry', 'file:x'];

describe('POST /host/extensions version', () => {
  it('refuses a path, a URL, a space, a flag or a file spec before any install', async () => {
    const install = vi.fn<Installer>(async () => {
      throw new Error('never called');
    });
    h = await startHarness({ install });
    for (const version of BAD) {
      const res = await h.call('POST', '/host/extensions', { id: 'probe', version });
      expect([version, res.status, res.body]).toMatchObject([
        version,
        400,
        { error: { code: 'VALIDATION_ERROR' } },
      ]);
    }
    expect(install).not.toHaveBeenCalled();
  });

  it('takes a version, a range and a dist-tag to the installer', async () => {
    const install = vi.fn<Installer>(async () => {
      throw new Error('stop here');
    });
    h = await startHarness({ install });
    for (const version of ['1.2.3', '^0.8', 'next'])
      await h.call('POST', '/host/extensions', { id: 'probe', version });
    expect(install.mock.calls.map(([spec]) => spec.version)).toEqual(['1.2.3', '^0.8', 'next']);
  });
});

describe('PATCH /host/extensions/{id} version', () => {
  it('refuses a path, a URL, a space, a flag or a file spec as POST does; the installer runs once', async () => {
    const dir = await hostedPackage();
    const install = vi.fn<Installer>(async ({ id }) => ({ id, version: '1.0.0', dir }));
    h = await startHarness({ install });
    await h.call('POST', '/host/extensions', { id: 'hosted', enabled: false });
    for (const version of BAD) {
      const res = await h.call('PATCH', '/host/extensions/hosted', { version });
      expect([version, res.status, res.body]).toMatchObject([
        version,
        400,
        { error: { code: 'VALIDATION_ERROR' } },
      ]);
    }
    expect(install).toHaveBeenCalledTimes(1);
  });
});
