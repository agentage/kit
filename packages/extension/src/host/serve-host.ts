import { readdir, readFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { SECRETS_DIR } from '../context/secrets.js';
import { parseObject } from '../context/settings.js';
import { createLog } from '../log/log.js';
import { portFromEnv, type Env } from '../runtime/build-info.js';
import { listen, shutdownOn } from '../server/serve.js';
import { hostExtension, type HostedExtension } from './host-extension.js';

export interface ServeHostDeps {
  exit?: (code: number) => void;
  signals?: NodeJS.Signals[];
  // Tells the parent (the daemon) the bound port: an IPC message when there is a channel.
  ready?: (port: number) => void;
}

export interface ServedHost {
  server: Server;
  host: HostedExtension;
  stop: () => void;
}

export const HOST_PORT = 8080;

// One file per secret name, as /run/secrets in a container; no folder reads as no secrets.
export const readSecretDir = async (dir: string): Promise<Record<string, string>> => {
  const names = await readdir(dir).catch(() => [] as string[]);
  const read = names.map(async (name) => [name, await readFile(join(dir, name), 'utf8')]);
  const pairs = await Promise.all(read);
  return Object.fromEntries(pairs.map(([name, text]) => [name, text!.replace(/\r?\n$/, '')]));
};

const sendReady = (port: number): void => void process.send?.({ type: 'ready', port });

// The child of the daemon and the one container: one package, /health, a SIGTERM drain.
export const serveHost = async (env: Env, deps: ServeHostDeps = {}): Promise<ServedHost> => {
  let stop = (): void => undefined;
  const host = await hostExtension(env['AGENTAGE_EXTENSION_DIR'] || process.cwd(), {
    dataDir: env['AGENTAGE_DATA_DIR'] ?? '',
    settings: env['AGENTAGE_SETTINGS'] ? parseObject(env['AGENTAGE_SETTINGS']) : {},
    secrets: await readSecretDir(env['AGENTAGE_SECRETS_DIR'] || SECRETS_DIR),
    onExit: () => stop(),
  });
  const bind = env['AGENTAGE_HOST_BIND'] === 'all' ? '0.0.0.0' : '127.0.0.1';
  const server = await listen(host.app, portFromEnv(env, HOST_PORT), bind);
  const log = createLog({ extension: host.id, part: 'api', version: host.version });
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const done = (code: number) => void host.stop().finally(() => exit(code));
  stop = shutdownOn(server, { app: host.app, port: 0, log, exit: done, signals: deps.signals });
  const { port } = server.address() as AddressInfo;
  log.info('listening', { port, bind });
  (deps.ready ?? sendReady)(port);
  return { server, host, stop };
};
