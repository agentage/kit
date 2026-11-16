import { randomBytes } from 'node:crypto';
import { type Express } from 'express';
import { type BuildInfo } from '../discovery/discovery.js';
import { healthBody } from '../health/health.js';
import { type HealthBody } from '../health/health.schema.js';
import { createLog, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type HostPartKind } from '../manifest/parts.js';
import { readManifest } from '../manifest/read-manifest.js';
import { buildInfoFromEnv } from '../runtime/build-info.js';
import { type PartAppBase } from '../server/app.js';
import { storeCheck } from '../store/store.js';
import { hostClockRate } from '../worker/clock.js';
import { localOnly } from './daemon/guard.js';
import { hostPartsOf, type HostedParts, type Hosting } from './host-parts.js';
import { openHostStore, STORE_OPEN_MS } from './host-store.js';

export interface HostOptions {
  dataDir: string;
  settings?: Record<string, unknown>;
  secrets?: Record<string, string>;
  onExit?: () => void;
  // ctx.extension.origin; http://127.0.0.1 when left out.
  origin?: string;
  // The daemon's guard: a Host of 127.0.0.1 or localhost at the port, a local Origin, no cross-site fetch.
  localOnly?: boolean;
  // Other local ports the guard lets a caller name: the daemon's, for the requests it forwards.
  localPorts?: number[];
  // The wait for the store to open, STORE_OPEN_MS when left out; past it /health says unavailable.
  storeOpenMs?: number;
}

export interface HostedExtension {
  id: string;
  version: string;
  // The server parts this process runs, in order: api, mcp, worker.
  parts: HostPartKind[];
  app: Express;
  stop(): Promise<void>;
  health(): Promise<HealthBody>;
}

// What the entry adds: secrets from a folder (as /run/secrets), and a token check off loopback.
export interface HostExtras {
  secretsDir?: string;
  guard?: (pkg: ExtensionPackage, log: Log) => Promise<Partial<PartAppBase>>;
  // The image's COMMIT_SHA and BUILD_TIME for /health; zeros when left out.
  build?: BuildInfo;
}

const once = (fn: () => void): (() => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
};

const baseOf = async (h: Hosting): Promise<PartAppBase> => {
  const guard = (await h.extras.guard?.(h.pkg, h.log)) ?? {};
  const checks = { ...(h.store && { store: storeCheck(h.store) }), ...guard.checks };
  const resolved = { instance: randomBytes(4).toString('hex'), startedAt: Date.now() };
  const clockRate = hostClockRate();
  const guards = h.opts.localOnly ? [localOnly(undefined, h.opts.localPorts)] : undefined;
  const { pkg, log, build, onExit } = h;
  return { pkg, log, build, onExit, guards, ...guard, checks, clockRate, ...resolved };
};

// The jobs stop before the store closes: a tick never writes to a closed store.
const hostedOf = (h: Hosting, hosted: HostedParts, base: PartAppBase): HostedExtension => {
  const { id } = h.pkg.agentage;
  const { version } = h.pkg;
  const { app, parts } = hosted;
  const { instance = '', startedAt = 0, build, checks, clockRate } = base;
  const at = { instance, startedAt, clockRate };
  const health = () =>
    healthBody({ extension: id, part: 'api', parts, version, build, checks, ...at });
  let stopped: Promise<void> | undefined;
  const close = () => (hosted.stop(), h.store ? h.store.close() : Promise.resolve());
  const stop = () => (stopped ??= close());
  return { id, version, parts, app, health, stop };
};

// hostExtension with the extras of the entry (dist/host/main.js).
export const hostWith = async (dir: string, opts: HostOptions, extras: HostExtras) => {
  const pkg = await readManifest(dir);
  const log = createLog({ extension: pkg.agentage.id, part: 'api', version: pkg.version });
  const openMs = opts.storeOpenMs ?? STORE_OPEN_MS;
  const store = await openHostStore(pkg, { dir, dataDir: opts.dataDir, openMs }, log);
  const onExit = once(opts.onExit ?? (() => undefined));
  const build = extras.build ?? buildInfoFromEnv({});
  const h: Hosting = { dir, pkg, log, opts, extras, store, onExit, build };
  try {
    const base = await baseOf(h);
    const hosted = await hostPartsOf(h, base);
    // After every create and the store open: the migrations ran or a job's first query waits on them.
    hosted.start();
    return hostedOf(h, hosted, base);
  } catch (err) {
    await store?.close();
    throw err;
  }
};

// One extension in this process: api at /api/{id}/*, mcp at /mcp/{id}, the worker jobs, one store, no token check.
export const hostExtension = (dir: string, opts: HostOptions): Promise<HostedExtension> =>
  hostWith(dir, opts, {});
