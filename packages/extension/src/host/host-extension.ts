import { randomBytes } from 'node:crypto';
import { type Express } from 'express';
import { createContext, type PartContext } from '../context/context.js';
import { secretsFrom } from '../context/secrets.js';
import { settingsOf } from '../context/settings.js';
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
import { type TestStore } from '../store/test-store.js';
import { openHostStore } from './host-store.js';

export interface HostOptions {
  dataDir: string;
  settings?: Record<string, unknown>;
  secrets?: Record<string, string>;
  onExit?: () => void;
}

export interface HostedExtension {
  id: string;
  version: string;
  app: Express;
  stop(): Promise<void>;
  health(): Promise<HealthBody>;
}

interface Hosting {
  dir: string;
  pkg: ExtensionPackage;
  log: Log;
  opts: HostOptions;
  store: TestStore | undefined;
  onExit: () => void;
}

const once = (fn: () => void): (() => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
};

const contextOf = async (h: Hosting, checks: Record<string, HealthCheck>): Promise<PartContext> =>
  createContext({
    pkg: h.pkg,
    part: 'api',
    origin: 'http://127.0.0.1',
    commit: buildInfoFromEnv({}).commit,
    log: h.log,
    settings: settingsOf(h.pkg, h.opts.settings ?? {}, h.log),
    store: h.store,
    secrets: await secretsFrom(h.pkg, 'api', async (name) => h.opts.secrets?.[name] ?? ''),
    checks,
    onExit: h.onExit,
  });

// The api part of the package with no token check; a package without one serves /health only.
const appOf = async (h: Hosting, base: PartAppBase, checks: Record<string, HealthCheck>) => {
  if (!normalizeParts(h.pkg.agentage.parts).code.api)
    return createPartApp({ ...base, part: 'api', mount: () => undefined });
  const ctx = await contextOf(h, checks);
  const input = { dir: h.dir, pkg: h.pkg, env: {}, ctx: () => ctx, base, openapi: null };
  const { app } = await RUNNERS.api({ ...input, openapi: await readOpenapi(h.dir) });
  return app;
};

const hostedOf = (h: Hosting, app: Express, base: PartAppBase): HostedExtension => {
  const resolved = { instance: randomBytes(4).toString('hex'), startedAt: Date.now() };
  const { id } = h.pkg.agentage;
  const { version } = h.pkg;
  const health = () =>
    healthBody({
      ...resolved,
      extension: id,
      part: 'api',
      version,
      build: base.build,
      checks: base.checks,
    });
  let stopped: Promise<void> | undefined;
  const stop = () => (stopped ??= h.store ? h.store.close() : Promise.resolve());
  return { id, version, app, health, stop };
};

// One extension in this process: its api at /api/{id}/*, its own settings, secrets, store and log.
export const hostExtension = async (dir: string, opts: HostOptions): Promise<HostedExtension> => {
  const pkg = await readManifest(dir);
  const log = createLog({ extension: pkg.agentage.id, part: 'api', version: pkg.version });
  const store = await openHostStore(dir, pkg, opts.dataDir, log);
  const h: Hosting = { dir, pkg, log, opts, store, onExit: once(opts.onExit ?? (() => undefined)) };
  const checks: Record<string, HealthCheck> = store ? { store: storeCheck(store) } : {};
  const base = { pkg, log, build: buildInfoFromEnv({}), checks, onExit: h.onExit };
  try {
    return hostedOf(h, await appOf(h, base, checks), base);
  } catch (err) {
    await store?.close();
    throw err;
  }
};
