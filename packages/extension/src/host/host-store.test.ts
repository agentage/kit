import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hostedPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { hostExtension } from './host-extension.js';

// A PGlite that never opens and never closes (a hung volume).
vi.mock('../store/pglite-store.js', async (original) => ({
  ...(await original<object>()),
  createPgliteStore: () => ({
    query: () => new Promise(() => undefined),
    close: () => new Promise(() => undefined),
  }),
}));

describe('a store that never opens', () => {
  it('the host starts after storeOpenMs, /health says the store is unavailable, stop ends', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dataDir = join(await tempDir('agentage-host-data-'), 'hosted');
    const secrets = { 'api-token': 't' };
    const host = await hostExtension(await hostedPackage(), { dataDir, secrets, storeOpenMs: 200 });
    expect(await host.health()).toMatchObject({
      success: false,
      data: { status: 'unavailable', checks: { store: 'unavailable' } },
    });
    await host.stop();
    // Not released: the hung store may still write in the folder until this process exits.
    await expect(access(`${dataDir}.lock`)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});
