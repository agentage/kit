import { type Express } from 'express';
import { createContext, type PartContext } from '../context/context.js';
import { readSecrets, secretsFrom } from '../context/secrets.js';
import { settingsOf } from '../context/settings.js';
import { type BuildInfo } from '../discovery/discovery.js';
import { readOpenapi } from '../discovery/openapi.js';
import { createLog, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hostParts, type HostPartKind } from '../manifest/parts.js';
import { mcpPathOf } from '../mcp/mcp-app.js';
import { MOUNTS, type PartMount, type RunnerInput } from '../runtime/part-mounts.js';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { type PgliteStore } from '../store/pglite-store.js';
import { type HostExtras, type HostOptions } from './host-extension.js';

export interface Hosting {
  dir: string;
  pkg: ExtensionPackage;
  log: Log;
  opts: HostOptions;
  extras: HostExtras;
  store: PgliteStore | undefined;
  onExit: () => void;
  build: BuildInfo;
}

// Every server part of one package on one app; jobs start only when asked (after all creates).
export interface HostedParts {
  app: Express;
  parts: HostPartKind[];
  start(): void;
  stop(): void;
}

const secretsOf = ({ pkg, opts, extras }: Hosting, part: HostPartKind) =>
  extras.secretsDir
    ? readSecrets(pkg, part, extras.secretsDir)
    : secretsFrom(pkg, part, async (name) => opts.secrets?.[name] ?? '');

// A ctx for each part: its own log and mounted secrets, the one store and the one map of checks.
const contextOf = async (h: Hosting, part: HostPartKind, base: PartAppBase) =>
  createContext({
    pkg: h.pkg,
    part,
    origin: h.opts.origin ?? 'http://127.0.0.1',
    commit: h.build.commit,
    log:
      part === 'api'
        ? h.log
        : createLog({ extension: h.pkg.agentage.id, part, version: h.pkg.version }),
    settings: settingsOf(h.pkg, h.opts.settings ?? {}, h.log),
    store: h.store,
    secrets: await secretsOf(h, part),
    checks: base.checks ?? {},
    onExit: h.onExit,
  });

const inputOf = async (h: Hosting, part: HostPartKind, base: PartAppBase): Promise<RunnerInput> => {
  const ctx: PartContext = await contextOf(h, part, base);
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
  try {
    for (const part of parts) mounts.push(await MOUNTS[part](await inputOf(h, part, base)));
  } catch (err) {
    for (const m of mounts) m.stop?.();
    throw err;
  }
  return mounts;
};

// The api at /api/{id}/*, the mcp at /mcp/{id}, the worker jobs; one /health with every check.
export const hostPartsOf = async (h: Hosting, base: PartAppBase): Promise<HostedParts> => {
  const parts = hostParts(h.pkg);
  const mounts = await mountsOf(h, parts, base);
  const mount = (app: Express) => mounts.forEach((m) => m.mount(app));
  const app = createPartApp({ ...base, parts, part: 'api', mount });
  const start = () => mounts.forEach((m) => m.start?.());
  const stop = () => mounts.forEach((m) => m.stop?.());
  return { app, parts, start, stop };
};
