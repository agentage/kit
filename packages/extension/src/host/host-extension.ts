import { randomBytes } from 'node:crypto';
import { type Express } from 'express';
import { createContext, type PartContext } from '../context/context.js';
import { readSecrets, secretsFrom } from '../context/secrets.js';
import { settingsOf } from '../context/settings.js';
import { type BuildInfo } from '../discovery/discovery.js';
import { readOpenapi } from '../discovery/openapi.js';
import { healthBody, type HealthCheck } from '../health/health.js';
import { type HealthBody } from '../health/health.schema.js';
import { createLog, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { normalizeParts } from '../manifest/parts.js';
import { readManifest } from '../manifest/read-manifest.js';
import { buildInfoFromEnv } from '../runtime/build-info.js';
import { RUNNERS } from '../runtime/part-runners.js';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { storeCheck } from '../store/store.js';
import { type PgliteStore } from '../store/pglite-store.js';
import { localOnly } from './daemon/guard.js';
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
  // The wait for the store to open, STORE_OPEN_MS when left out; past it /health says unavailable.
  storeOpenMs?: number;
}

export interface HostedExtension {
  id: string;
  version: string;
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

interface Hosting {
  dir: string;
  pkg: ExtensionPackage;
  log: Log;
  opts: HostOptions;
  extras: HostExtras;
  store: PgliteStore | undefined;
  onExit: () => void;
  build: BuildInfo;
}

const once = (fn: () => void): (() => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
};

const secretsOf = ({ pkg, opts, extras }: Hosting) =>
  extras.secretsDir
    ? readSecrets(pkg, 'api', extras.secretsDir)
    : secretsFrom(pkg, 'api', async (name) => opts.secrets?.[name] ?? '');

// createContext with the host's values: settings and secrets as given, no platform.
const contextOf = async (h: Hosting, checks: Record<string, HealthCheck>): Promise<PartContext> =>
  createContext({
    pkg: h.pkg,
    part: 'api',
    origin: h.opts.origin ?? 'http://127.0.0.1',
    commit: h.build.commit,
    log: h.log,
    settings: settingsOf(h.pkg, h.opts.settings ?? {}, h.log),
    store: h.store,
    secrets: await secretsOf(h),
    checks,
    onExit: h.onExit,
  });

// The api part of the package; a package without one serves /health only.
const appOf = async (h: Hosting, base: PartAppBase) => {
  if (!normalizeParts(h.pkg.agentage.parts).code.api)
    return createPartApp({ ...base, part: 'api', mount: () => undefined });
  const ctx = await contextOf(h, base.checks ?? {});
  const openapi = await readOpenapi(h.dir);
  return (await RUNNERS.api({ dir: h.dir, pkg: h.pkg, env: {}, ctx: () => ctx, base, openapi }))
    .app;
};

const baseOf = async (h: Hosting): Promise<PartAppBase> => {
  const guard = (await h.extras.guard?.(h.pkg, h.log)) ?? {};
  const checks = { ...(h.store && { store: storeCheck(h.store) }), ...guard.checks };
  const resolved = { instance: randomBytes(4).toString('hex'), startedAt: Date.now() };
  const guards = h.opts.localOnly ? [localOnly()] : undefined;
  const { pkg, log, build, onExit } = h;
  return { pkg, log, build, onExit, guards, ...guard, checks, ...resolved };
};

const hostedOf = (h: Hosting, app: Express, base: PartAppBase): HostedExtension => {
  const { id } = h.pkg.agentage;
  const { version } = h.pkg;
  const { instance = '', startedAt = 0, build, checks } = base;
  const health = () =>
    healthBody({ extension: id, part: 'api', version, build, checks, instance, startedAt });
  let stopped: Promise<void> | undefined;
  const stop = () => (stopped ??= h.store ? h.store.close() : Promise.resolve());
  return { id, version, app, health, stop };
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
    return hostedOf(h, await appOf(h, base), base);
  } catch (err) {
    await store?.close();
    throw err;
  }
};

// One extension in this process: its api at /api/{id}/*, no token check, its own settings, secrets, store and log.
export const hostExtension = (dir: string, opts: HostOptions): Promise<HostedExtension> =>
  hostWith(dir, opts, {});
