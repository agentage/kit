import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostedPackage,
  NO_STORE_MANIFEST,
} from '../../extension/src/test-support/hosted-fixture.js';
import { inProcessLaunch } from './test-support/in-process-launch.js';
import { BUILT_MAIN } from '../../extension/src/test-support/launch-spec.js';
import { tempDir } from '../../extension/src/test-support/packages.js';
import { forkLaunch, type LaunchSpec } from './child.js';
import { childRunner, runOf, type Run, type Runner } from './runner.js';

const specOf = async (manifest: object = NO_STORE_MANIFEST): Promise<LaunchSpec> => {
  const configDir = await tempDir('agentage-runner-');
  return {
    id: 'hosted',
    dir: await hostedPackage(manifest),
    dataDir: join(configDir, 'data', 'hosted'),
    settings: {},
    secrets: { 'api-token': 'k' },
    origin: 'http://127.0.0.1',
  };
};

const BROKEN = { ...NO_STORE_MANIFEST, agentage: { ...NO_STORE_MANIFEST.agentage, parts: 7 } };

const started: Run[] = [];
beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  await Promise.all(started.splice(0).map((run) => run.stop()));
  vi.restoreAllMocks();
});

// The runner contract (J.4.3 row 3): every runner of the program passes the same cases.
const runnerContract = (name: string, make: () => Runner) =>
  describe(`runner contract: ${name}`, () => {
    it('start gives a running extension at an address that answers /health', async () => {
      const run = await make().start(await specOf());
      started.push(run);
      expect(run.state()).toBe('running');
      expect(run.address()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect((await fetch(`${run.address()}/health`)).status).toBe(200);
    });

    it('stop ends it: state exited, the address refuses', async () => {
      const run = await make().start(await specOf());
      await run.stop();
      await run.exited;
      expect(run.state()).toBe('exited');
      await expect(fetch(`${run.address()}/health`)).rejects.toThrow();
    });

    it('a package that cannot start rejects, and nothing runs', async () => {
      await expect(make().start(await specOf(BROKEN))).rejects.toThrow();
    });
  });

runnerContract('child, in process', () => childRunner(inProcessLaunch));

// The fork needs the built host entry: verify builds it (tsc -b) before the tests run.
if (!existsSync(BUILT_MAIN)) throw new Error(`${BUILT_MAIN} is missing: npm run build first`);
runnerContract('child, forked', () => childRunner(forkLaunch(BUILT_MAIN, 10_000)));

describe('runOf', () => {
  it('the state follows the exit of the child, also an exit it did not ask for', async () => {
    let exit = () => undefined as void;
    const exited = new Promise<{ code: number; signal: null }>(
      (resolve) => (exit = () => resolve({ code: 1, signal: null }))
    );
    const run = runOf({ port: 5, pid: 1, exited, stop: async () => undefined });
    expect([run.state(), run.address()]).toEqual(['running', 'http://127.0.0.1:5']);
    exit();
    await exited;
    expect(run.state()).toBe('exited');
  });

  it('the child runner kind is child', () => {
    expect(childRunner(inProcessLaunch).kind).toBe('child');
  });
});
