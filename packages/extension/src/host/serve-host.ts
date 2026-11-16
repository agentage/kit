import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLog } from '../log/log.js';
import { type Env } from '../runtime/build-info.js';
import { listen, shutdownOn } from '../server/serve.js';
import { loopbackPorts } from './daemon/guard.js';
import { guardOf, hostEnvOf } from './host-env.js';
import { hostBuildInfo, hostWith, type HostedExtension } from './host-extension.js';

interface ServeHostDeps {
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

export const ORPHAN_MS = 10_000;

// The port to the daemon; its IPC channel closed: drain, and exit within ORPHAN_MS in any case.
export const announce = (port: number, stop: () => void, exit = process.exit): void => {
  if (!process.send) return;
  process.send({ type: 'ready', port });
  process.once('disconnect', () => {
    stop();
    setTimeout(() => exit(1), ORPHAN_MS).unref();
  });
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
const drainOn = (server: Server, host: HostedExtension, deps: ServeHostDeps, graceMs: number) => {
  const log = createLog({ extension: host.id, part: 'api', version: host.version });
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  // A store close that hangs gets graceMs too, so the process always exits.
  const closed = () => Promise.race([host.stop(), sleep(graceMs, undefined, { ref: false })]);
  const done = (code: number) => void closed().finally(() => exit(code));
  const stop = shutdownOn(server, {
    app: host.app,
    port: 0,
    log,
    exit: done,
    signals: deps.signals,
    graceMs,
  });
  return { log, stop };
};

// The child of the daemon and the one container: one package, /health, a SIGTERM drain.
export const serveHost = async (env: Env, deps: ServeHostDeps = {}): Promise<ServedHost> => {
  const at = hostEnvOf(env);
  const guard = guardOf(env, at);
  const hook = exitHook();
  const { dataDir, runDir, settings, origin, secretsDir, storeOpenMs } = at;
  // C2: on loopback the child checks Host and Origin itself, for its own port and the daemon's.
  const local = { localOnly: at.bind === '127.0.0.1', localPorts: loopbackPorts(origin) };
  const opts = { dataDir, runDir, settings, origin, storeOpenMs, onExit: hook.onExit, ...local };
  const build = await hostBuildInfo(env, at.dir);
  const host = await hostWith(at.dir, opts, { secretsDir, guard, build });
  const server = await listen(host.app, at.port, at.bind);
  const { log, stop } = drainOn(server, host, deps, at.drainMs);
  const { port } = server.address() as AddressInfo;
  log.info('listening', { port, bind: at.bind, parts: host.parts.join(',') });
  (deps.ready ?? announce)(port, stop);
  hook.arm(stop);
  return { server, host, stop };
};
