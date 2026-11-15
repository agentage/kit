import { type Launch } from '../host/daemon/child.js';
import { startDaemon, type Daemon } from '../host/daemon/daemon.js';
import { type Installer } from '../host/daemon/supervisor.js';
import { inProcessLaunch } from './in-process-launch.js';
import { tempDir } from './packages.js';

export interface Harness {
  daemon: Daemon;
  configDir: string;
  call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export const tempConfigDir = () => tempDir('agentage-daemon-');

export const startHarness = async (
  options: { install?: Installer; configDir?: string; launch?: Launch } = {}
): Promise<Harness> => {
  const configDir = options.configDir ?? (await tempConfigDir());
  const opts = {
    configDir,
    port: 0,
    version: '0.13.0',
    startedBy: 'test',
    install: options.install,
  };
  const daemon = await startDaemon(opts, options.launch ?? inProcessLaunch);
  const call = async (method: string, path: string, body?: unknown) => {
    const init = { method, headers: { 'content-type': 'application/json' } };
    const sent = body === undefined ? init : { ...init, body: JSON.stringify(body) };
    const res = await fetch(`http://127.0.0.1:${daemon.port}${path}`, sent);
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
  };
  return { daemon, configDir, call };
};
