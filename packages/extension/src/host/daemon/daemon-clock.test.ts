import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness } from '../../test-support/daemon-harness.js';
import { launchSpec } from '../../test-support/launch-spec.js';
import { tempDir } from '../../test-support/packages.js';
import { createDaemon } from './daemon.js';
import { forkLaunch, type Launch } from './child.js';
import { inProcessLaunch } from '../../test-support/in-process-launch.js';

let h: Harness | undefined;
beforeEach(() => void vi.spyOn(process.stderr, 'write').mockImplementation(() => true));
afterEach(async () => {
  await h?.daemon.stop();
  h = undefined;
  vi.restoreAllMocks();
});

const clockSeenByChild = async (rate?: number) => {
  const dir = await tempDir('agentage-clock-');
  const out = join(dir, 'seen.txt');
  const main = join(dir, 'main.mjs');
  const body = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(out)}, String(process.env.AGENTAGE_CLOCK_RATE)); process.exit(1);`;
  await writeFile(main, body);
  // Below the floor: the script is in a temp folder no seal grant names.
  await forkLaunch(main, 2000, rate, '24.6.0')(await launchSpec()).catch(() => undefined);
  return readFile(out, 'utf8');
};

describe('daemon test clock (C5)', () => {
  it('/health shows the clockRate of the launch that forks the children, only when not 1', async () => {
    h = await startHarness({
      launch: Object.assign((spec: Parameters<Launch>[0]) => inProcessLaunch(spec), {
        clockRate: 60,
      }),
    });
    expect(await h.call('GET', '/health')).toMatchObject({ body: { clockRate: 60 } });
    await h.daemon.stop();
    h = await startHarness();
    expect((await h.call('GET', '/health')).body).not.toHaveProperty('clockRate');
  });

  it('createDaemon rejects a bad rate, as a rejected promise, before it writes anything', async () => {
    const configDir = await tempDir('agentage-clock-cfg-');
    const opts = { configDir, port: 0, version: '0.13.0', startedBy: 'test' };
    await expect(createDaemon({ ...opts, clockRate: 0 })).rejects.toThrow('AGENTAGE_CLOCK_RATE');
    await expect(createDaemon({ ...opts, clockRate: 7200 })).rejects.toThrow('AGENTAGE_CLOCK_RATE');
  });

  it('each child gets AGENTAGE_CLOCK_RATE only when the rate is not 1', async () => {
    expect(await clockSeenByChild(60)).toBe('60');
    expect(await clockSeenByChild()).toBe('undefined');
  });
});
