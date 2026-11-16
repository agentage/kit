import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_MANIFEST, json, tempDir, tempPackage } from './packages.js';

// The built child entry: verify builds it (tsc -b) before the tests run.
export const BUILT_MAIN = fileURLToPath(new URL('../../dist/host/main.js', import.meta.url));

// A forkLaunch spec as the supervisor builds it: <config>/data/{id}, a package that declares api-token.
export const launchSpec = async (secrets: Record<string, string> = {}) => {
  const configDir = await tempDir('agentage-cfg-');
  const manifest = {
    ...API_MANIFEST,
    agentage: { ...API_MANIFEST.agentage, secrets: ['api-token'] },
  };
  const dir = await tempPackage({ 'package.json': json(manifest) });
  const dataDir = join(configDir, 'data', 'probe');
  return {
    configDir,
    id: 'probe',
    dir,
    dataDir,
    settings: {},
    secrets,
    origin: 'http://127.0.0.1',
  };
};
