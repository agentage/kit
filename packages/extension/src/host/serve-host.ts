import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createLog } from '../log/log.js';
import { type Env } from '../runtime/build-info.js';
import { listen, shutdownOn } from '../server/serve.js';
import { guardOf, hostEnvOf } from './host-env.js';
import { hostWith, type HostedExtension } from './host-extension.js';

export interface ServeHostDeps {
  exit?: (code: number) => void;
  signals?: NodeJS.Signals[];
  // Tells the parent (the daemon) the bound port: an IPC message when there is a channel.
  ready?: (port: number, stop: () => void) => void;
}

export interface ServedHost {
  server: Server;
  host: HostedExtension;
  stop: () => void;
}

// The port to the daemon; the daemon gone (its IPC channel closed): drain and exit, no orphan.
export const announce = (port: number, stop: () => void): void => {
  if (!process.send) return;
  process.send({ type: 'ready', port });
  process.once('disconnect', stop);
};

// A ctx.exit() before the server listens (in create) runs once it can drain.
const exitHook = () => {
  let stop: (() => void) | undefined;
  let pending = false;
  const onExit = () => (stop ? stop() : (pending = true));
  const arm = (fn: () => void) => {
    stop = fn;
    if (pending) fn();
  };
  return { onExit, arm };
};

// SIGTERM, ctx.exit() and a gone parent drain the server, then stop the host and exit.
const drainOn = (server: Server, host: HostedExtension, deps: ServeHostDeps) => {
  const log = createLog({ extension: host.id, part: 'api', version: host.version });
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const done = (code: number) => void host.stop().finally(() => exit(code));
  const stop = shutdownOn(server, {
    app: host.app,
    port: 0,
    log,
    exit: done,
    signals: deps.signals,
  });
  return { log, stop };
};

// The child of the daemon and the one container: one package, /health, a SIGTERM drain.
export const serveHost = async (env: Env, deps: ServeHostDeps = {}): Promise<ServedHost> => {
  const at = hostEnvOf(env);
  const guard = guardOf(env, at);
  const hook = exitHook();
  const { dataDir, settings, origin, secretsDir } = at;
  const opts = { dataDir, settings, origin, onExit: hook.onExit };
  const host = await hostWith(at.dir, opts, { secretsDir, guard });
  const server = await listen(host.app, at.port, at.bind);
  const { log, stop } = drainOn(server, host, deps);
  const { port } = server.address() as AddressInfo;
  log.info('listening', { port, bind: at.bind });
  (deps.ready ?? announce)(port, stop);
  hook.arm(stop);
  return { server, host, stop };
};
