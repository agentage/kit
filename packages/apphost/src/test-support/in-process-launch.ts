import { writeFile } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { childEnv, type Exit, type Launch } from '../child.js';
import { serveHost } from '@agentage/extension/internal';
import { tempDir } from '../../../extension/src/test-support/packages.js';

// The daemon's children in the test process: the same host code, no fork.
export const inProcessLaunch: Launch = async (spec) => {
  const secretsDir = await tempDir('agentage-test-secrets-');
  for (const [name, value] of Object.entries(spec.secrets))
    await writeFile(join(secretsDir, name), value);
  let done = () => undefined as void;
  const exited = new Promise<Exit>((resolve) => (done = () => resolve({ code: 0, signal: null })));
  const served = await serveHost(childEnv(spec, secretsDir), {
    signals: [],
    exit: () => done(),
    ready: () => undefined,
  });
  const { port } = served.server.address() as AddressInfo;
  return { port, pid: process.pid, exited, stop: async () => void (served.stop(), await exited) };
};
