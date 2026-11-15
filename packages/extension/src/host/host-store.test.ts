import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostedPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { childEnv } from './daemon/child.js';
import { LIMITS } from './daemon/limits.js';
import { hostEnvOf } from './host-env.js';
import { hostExtension } from './host-extension.js';

// A PGlite whose first query ends after opensInMs (never when undefined), and that never closes.
let opensInMs: number | undefined;
let created = false;
vi.mock('../store/pglite-store.js', async (original) => ({
  ...(await original<object>()),
  createPgliteStore: () => {
    created = true;
    const opened =
      opensInMs === undefined
        ? new Promise(() => undefined)
        : new Promise((resolve) => setTimeout(resolve, opensInMs));
    return {
      query: () => opened.then(() => ({ rows: [] })),
      close: () => new Promise(() => undefined),
    };
  },
}));

const SECRETS = { 'api-token': 't' };
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a store that never opens', () => {
  it('the host starts after storeOpenMs, /health says the store is unavailable, stop ends', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    opensInMs = undefined;
    const dataDir = join(await tempDir('agentage-host-data-'), 'hosted');
    const opts = { dataDir, secrets: SECRETS, storeOpenMs: 200 };
    const host = await hostExtension(await hostedPackage(), opts);
    expect(await host.health()).toMatchObject({
      success: false,
      data: { status: 'unavailable', checks: { store: 'unavailable' } },
    });
    await host.stop();
    // Not released: the hung store may still write in the folder until this process exits.
    await expect(access(`${dataDir}.lock`)).resolves.toBeUndefined();
  });
});

describe('a store that opens in 40 s under the default daemon', () => {
  it('gets the daemon healthMs (60 s) as its bound: it starts with the store ready', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spec = { id: 'hosted', dir: '/x', dataDir: '', settings: {}, secrets: {}, origin: '' };
    const env = childEnv({ ...spec, storeOpenMs: LIMITS.healthMs }, '/run/secrets');
    const { storeOpenMs } = hostEnvOf(env);
    expect(storeOpenMs).toBe(60_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    opensInMs = 40_000;
    const pkg = await hostedPackage();
    created = false;
    const started = hostExtension(pkg, { dataDir: '', secrets: SECRETS, storeOpenMs });
    // vi.waitFor runs on real timers: the store and its bound timers are set once this is true.
    await vi.waitFor(() => expect(created).toBe(true));
    await vi.advanceTimersByTimeAsync(40_000);
    const host = await started;
    vi.useRealTimers();
    const health = await host.health();
    expect(health).toMatchObject({ data: { checks: { store: 'ok' } } });
  });
});
