import { type Express } from 'express';
import { createContext, type PartContext } from '../context/context.js';
import { readSecrets, secretsFrom } from '../context/secrets.js';
import { settingsOf } from '../context/settings.js';
import { hostedRecordOf, type BuildInfo } from '../discovery/discovery.js';
import { readOpenapi } from '../discovery/openapi.js';
import { migrationsOf } from '../discovery/served-extras.js';
import { createLog, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hostParts, type HostPartKind } from '../manifest/parts.js';
import { mcpPathOf } from '../mcp/mcp-app.js';
import { MOUNTS, type PartMount, type RunnerInput } from '../runtime/part-mounts.js';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { type HealthCheck } from '../health/health.js';
import { appRowIn, mountAppBundle } from './app-bundle.js';
import { type HostExtras, type HostOptions } from './host-extension.js';
import { type HostStore } from './host-url-store.js';
import { partChecks } from './part-checks.js';

export interface Hosting {
  dir: string;
  pkg: ExtensionPackage;
  log: Log;
  opts: HostOptions;
  extras: HostExtras;
  store: HostStore | undefined;
  onExit: () => void;
  build: BuildInfo;
}

// Every server part of one package on one app; jobs start only when asked (after all creates).
export interface HostedParts {
  app: Express;
  parts: HostPartKind[];
  start(): void;
  // Resolves once the jobs still running have ended.
  stop(): Promise<void>;
}

const secretsOf = ({ pkg, opts, extras }: Hosting, part: HostPartKind) =>
  extras.secretsDir
    ? readSecrets(pkg, part, extras.secretsDir)
    : secretsFrom(pkg, part, async (name) => opts.secrets?.[name] ?? '');

// A ctx for each part: its own log and mounted secrets, the one store and the one map of checks.
const contextOf = async (h: Hosting, part: HostPartKind, checks: Record<string, HealthCheck>) =>
  createContext({
    pkg: h.pkg,
    part,
    origin: h.opts.origin ?? 'http://127.0.0.1',
    commit: h.build.commit,
    platform: h.opts.platform,
    log:
      part === 'api'
        ? h.log
        : createLog({ extension: h.pkg.agentage.id, part, version: h.pkg.version }),
    settings: settingsOf(h.pkg, h.opts.settings ?? {}, h.log),
    store: h.store,
    secrets: await secretsOf(h, part),
    checks,
    onExit: h.onExit,
  });

const inputOf = async (
  h: Hosting,
  part: HostPartKind,
  base: PartAppBase,
  reserved: Set<string>
): Promise<RunnerInput> => {
  const ctx: PartContext = await contextOf(h, part, partChecks(base.checks ?? {}, reserved));
  const openapi = await readOpenapi(h.dir);
  const mcpPaths = [mcpPathOf(h.pkg.agentage.id)];
  return {
    dir: h.dir,
    pkg: h.pkg,
    env: {},
    ctx: () => ctx,
    base,
    openapi,
    mcpPaths,
    openListing: !base.tokenCheck,
  };
};

// In order api, mcp, worker; a create that throws stops what the earlier ones started.
const mountsOf = async (h: Hosting, parts: HostPartKind[], base: PartAppBase) => {
  const mounts: PartMount[] = [];
  // The host's own checks (store, token) stay refused names, as in a part image.
  const reserved = new Set(Object.keys(base.checks ?? {}));
  try {
    for (const part of parts)
      mounts.push(await MOUNTS[part](await inputOf(h, part, base, reserved)));
  } catch (err) {
    for (const m of mounts) void m.stop?.();
    throw err;
  }
  return mounts;
};

// The record a part image reads from its build, here from what each part serves.
const recordOf = async (h: Hosting, parts: HostPartKind[], mounts: PartMount[]) => {
  const extras = Object.assign(await migrationsOf(h.dir, h.pkg), ...mounts.map((m) => m.record));
  return hostedRecordOf(h.pkg, h.build, parts, extras);
};

// The api at /api/{id}/*, the mcp at /mcp/{id}, the app at /app/{id}/*, the jobs; one /health.
export const hostPartsOf = async (h: Hosting, base: PartAppBase): Promise<HostedParts> => {
  const parts = hostParts(h.pkg);
  const mounts = await mountsOf(h, parts, base);
  const row = await appRowIn(h.dir, h.pkg);
  const mount = (app: Express) => {
    mountAppBundle(app, h.dir, h.pkg.agentage.id, row);
    mounts.forEach((m) => m.mount(app));
  };
  const record = await recordOf(h, parts, mounts);
  const app = createPartApp({
    ...base,
    parts,
    part: 'api',
    mount,
    record,
    ...(row && { app: row }),
  });
  const start = () => mounts.forEach((m) => m.start?.());
  const stop = async () => void (await Promise.all(mounts.map((m) => m.stop?.())));
  return { app, parts, start, stop };
};
