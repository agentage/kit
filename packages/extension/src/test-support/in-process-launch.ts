import { writeFile } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Launch } from '../host/daemon/child.js';
import { serveHost } from '../host/serve-host.js';
import { tempDir } from './packages.js';

// The daemon's children in the test process: the same host code, no fork.
export const inProcessLaunch: Launch = async (spec) => {
  const secretsDir = await tempDir('agentage-test-secrets-');
  for (const [name, value] of Object.entries(spec.secrets))
    await writeFile(join(secretsDir, name), value);
  let done = () => undefined as void;
  const exited = new Promise<void>((resolve) => (done = resolve));
  const env = {
    PORT: '0',
    AGENTAGE_EXTENSION_DIR: spec.dir,
    AGENTAGE_DATA_DIR: spec.dataDir,
    AGENTAGE_SETTINGS: JSON.stringify(spec.settings),
    AGENTAGE_SECRETS_DIR: secretsDir,
  };
  const served = await serveHost(env, { signals: [], exit: () => done(), ready: () => undefined });
  const { port } = served.server.address() as AddressInfo;
  return { port, exited, stop: async () => (served.stop(), exited) };
};
