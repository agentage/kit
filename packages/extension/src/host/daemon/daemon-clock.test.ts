import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { tempDir } from '../../test-support/packages.js';
import { forkLaunch } from './child.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const SPEC = { id: 'x', dir: '/x', dataDir: '/x', settings: {}, secrets: {}, origin: 'http://x' };

const clockSeenByChild = async (rate?: number) => {
  const dir = await tempDir('agentage-clock-');
  const out = join(dir, 'seen.txt');
  const main = join(dir, 'main.mjs');
  const body = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(out)}, String(process.env.AGENTAGE_CLOCK_RATE)); process.exit(1);`;
  await writeFile(main, body);
  await forkLaunch(main, 2000, rate)(SPEC).catch(() => undefined);
  return readFile(out, 'utf8');
};

describe('daemon test clock (C5)', () => {
  it('/health shows clockRate only when it is not 1', async () => {
    h = await startHarness({ clockRate: 60 });
    expect(await h.call('GET', '/health')).toMatchObject({ body: { clockRate: 60 } });
    await h.daemon.stop();
    h = await startHarness({ clockRate: 1 });
    expect((await h.call('GET', '/health')).body).not.toHaveProperty('clockRate');
  });

  it('refuses a bad rate before it listens', async () => {
    await expect(startHarness({ clockRate: 0 })).rejects.toThrow('AGENTAGE_CLOCK_RATE');
  });

  it('each child gets AGENTAGE_CLOCK_RATE only when the rate is not 1', async () => {
    expect(await clockSeenByChild(60)).toBe('60');
    expect(await clockSeenByChild()).toBe('undefined');
  });
});
