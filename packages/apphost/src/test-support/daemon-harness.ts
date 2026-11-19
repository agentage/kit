import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Launch } from '../child.js';
import { startDaemon, type Daemon, type DaemonOptions } from '../daemon.js';
import { inProcessLaunch } from './in-process-launch.js';
import { json, tempDir } from '../../../extension/src/test-support/packages.js';

export interface Harness {
  daemon: Daemon;
  configDir: string;
  // The host token of daemon.json, as the cli reads it.
  token: string;
  call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

// D11: what the cli does, the token from daemon.json on /host/* only.
export const hostTokenOf = async (configDir: string): Promise<string> =>
  (JSON.parse(await readFile(join(configDir, 'daemon.json'), 'utf8')) as { hostToken: string })
    .hostToken;

export const authOf = (token: string, path: string): Record<string, string> =>
  path.startsWith('/host') ? { authorization: `Bearer ${token}` } : {};

export const tempConfigDir = () => tempDir('agentage-daemon-');

// The secret the hosted fixture needs, for each id, as the daemon keeps it (0600).
export const writeSecrets = (configDir: string, ids = ['hosted']) =>
  writeFile(
    join(configDir, 'secrets.json'),
    json(Object.fromEntries(ids.map((id) => [id, { 'api-token': 't' }]))),
    { mode: 0o600 }
  );

export const startHarness = async (
  options: Partial<DaemonOptions> & { launch?: Launch } = {}
): Promise<Harness> => {
  const { launch = inProcessLaunch, ...rest } = options;
  const configDir = options.configDir ?? (await tempConfigDir());
  // No shell unless a test names one: the workspace package may be unbuilt.
  const opts = {
    port: 0,
    version: '0.13.0',
    startedBy: 'test',
    shellDir: null,
    ...rest,
    configDir,
  };
  const daemon = await startDaemon(opts, launch);
  const token = await hostTokenOf(configDir);
  const call = async (method: string, path: string, body?: unknown) => {
    const headers = { 'content-type': 'application/json', ...authOf(token, path) };
    const init = { method, headers };
    const sent = body === undefined ? init : { ...init, body: JSON.stringify(body) };
    const res = await fetch(`http://127.0.0.1:${daemon.port}${path}`, sent);
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
  };
  return { daemon, configDir, token, call };
};
