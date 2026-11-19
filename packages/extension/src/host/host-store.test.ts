import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostedPackage } from '../test-support/hosted-fixture.js';
import { tempDir } from '../test-support/packages.js';
import { childEnv } from './child-env.js';
import { hostEnvOf } from './host-env.js';
import { hostExtension } from './host-extension.js';
import { lockOf } from './host-store.js';

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
// The health limit of the app host program (its LIMITS.healthMs).
const DAEMON_HEALTH_MS = 60_000;
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
    const env = childEnv({ ...spec, storeOpenMs: DAEMON_HEALTH_MS }, '/run/secrets');
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

describe('the store lock in run/{id} (C2)', () => {
  it('lockOf: run/{id}/store.lock when the daemon gives runDir, else beside the folder', () => {
    expect(lockOf({ dataDir: '/c/data/p', runDir: '/c/run/p' })).toBe('/c/run/p/store.lock');
    expect(lockOf({ dataDir: '/c/data/p' })).toBe('/c/data/p.lock');
  });

  it('a live old lock beside the folder does not block: the lock is in runDir', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    opensInMs = 0;
    const root = await tempDir('agentage-host-lock-');
    const [dataDir, runDir] = [join(root, 'data', 'hosted'), join(root, 'run', 'hosted')];
    await mkdir(join(root, 'data'), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(`${dataDir}.lock`, String(process.ppid));
    const h = await hostExtension(await hostedPackage(), { dataDir, runDir, secrets: SECRETS });
    expect(await readFile(join(runDir, 'store.lock'), 'utf8')).toBe(String(process.pid));
    void h.stop();
  });
});
