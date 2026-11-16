import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { wordLaunch, wordPackage } from '../../test-support/word-launch.js';
import { type Installer } from './supervisor.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const reload = (id: string, body: unknown = {}) =>
  h!.call('POST', `/host/extensions/${id}/reload`, body);

describe('POST /host/extensions/{id}/reload refusals', () => {
  it('400 a body with keys, 404 an unknown id, 400 a market row, 409 a disabled folder', async () => {
    const dir = await wordPackage('one', 'market');
    const install = vi.fn<Installer>(async ({ id }) => ({ id, version: '1.0.0', dir }));
    h = await startHarness({ launch: wordLaunch().launch, install });
    await h.call('POST', '/host/extensions', { id: 'market' });
    const folder = await wordPackage('two');
    await h.call('POST', '/host/extensions', { source: folder, enabled: false });
    const refused = [
      [await reload('market', { force: true }), 400, 'VALIDATION_ERROR'],
      [await reload('nope'), 404, 'NOT_FOUND'],
      [await reload('market'), 400, 'VALIDATION_ERROR'],
      [await reload('word'), 409, 'CONFLICT'],
    ] as const;
    for (const [res, status, code] of refused)
      expect(res).toMatchObject({ status, body: { error: { code } } });
    expect((await reload('market')).body).toMatchObject({
      error: { message: 'market is not a folder: only a linked folder reloads' },
    });
  });
});
