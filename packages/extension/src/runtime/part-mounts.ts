import { type Express } from 'express';
import { generatedOpenapi } from '../api/openapi-doc.js';
import { type PartContext } from '../context/context.js';
import { type RecordExtras } from '../discovery/discovery.js';
import { openapiPath } from '../discovery/openapi.js';
import { toolRecords } from '../discovery/served-extras.js';
import { type HealthCheck } from '../health/health.js';
import { loadCreate, type ImportModule } from '../manifest/entry.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore, type HostPartKind } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { createSpan } from '../log/span.js';
import { mountMcp, type McpAppOptions } from '../mcp/mcp-app.js';
import { createToolRegistry } from '../mcp/tools.js';
import { mountApiRoutes, type PartAppBase } from '../server/app.js';
import { mountApi } from '../server/api-routes.js';
import { runLog } from '../worker/run-log.js';
import { memoryRuns, storeRuns } from '../worker/runs.js';
import { createScheduler } from '../worker/scheduler.js';
import { type Env } from './build-info.js';

export interface RunnerInput {
  dir: string;
  pkg: ExtensionPackage;
  env: Env;
  ctx: () => PartContext;
  base: PartAppBase;
  openapi: Record<string, unknown> | null;
  importModule?: ImportModule;
  // More api prefixes that serve the same router.
  apiAliases?: string[];
  // Where the mcp endpoint is; /mcp when left out (a part image).
  mcpPaths?: string[];
  // A host with no token check: tools/list stays open whatever mcp.listing says.
  openListing?: boolean;
}

// A part's routes for one app, and its jobs: start once every part is created, stop before the store closes.
export interface PartMount {
  mount: (app: Express) => void;
  checks?: Record<string, HealthCheck>;
  start?: () => void;
  stop?: () => void | Promise<void>;
  // What this part adds to the record the kit host serves (openapi, tools).
  record?: RecordExtras;
}

// ui has no code to run; every other part is its create(ctx).
export const callCreate = async <C>(
  input: RunnerInput,
  part: ImagePartKind,
  ctx: C
): Promise<unknown> => (await loadCreate<C>(input.dir, input.pkg, part, input.importModule))(ctx);

const api = async (input: RunnerInput): Promise<PartMount> => {
  const ctx = input.ctx();
  const { router, routes, documents } = await mountApi(ctx, (api) => callCreate(input, 'api', api));
  // Declared routes guard at their own scope, whatever the committed file says.
  const openapi = routes.length > 0 ? generatedOpenapi(input.pkg, routes) : input.openapi;
  const options = { ...input.base, router, routes, openapi, wellKnown: documents };
  const record = openapi ? { openapi: openapiPath(input.pkg.agentage.id) } : {};
  return { mount: (app) => mountApiRoutes(app, { ...options, aliases: input.apiAliases }), record };
};

const mcp = async (input: RunnerInput): Promise<PartMount> => {
  const registry = createToolRegistry();
  const ctx = input.ctx();
  await callCreate(input, 'mcp', { ...ctx, tool: registry.tool });
  const token = !input.openListing && ctx.settings['mcp.listing'] === 'token';
  const listing: McpAppOptions['listing'] = token ? 'token' : 'open';
  const options = { ...input.base, tools: registry.tools, listing, paths: input.mcpPaths };
  const tools = toolRecords(input.pkg.agentage.id, registry.tools);
  return { mount: (app) => mountMcp(app, options), record: tools.length ? { tools } : {} };
};

const worker = async (input: RunnerInput): Promise<PartMount> => {
  const ctx = input.ctx();
  const log = runLog(ctx.log);
  const runs = hasStore(input.pkg, 'postgres') ? storeRuns(ctx.store) : memoryRuns();
  const scheduler = createScheduler({ runs, log });
  const span = createSpan(log);
  await callCreate(input, 'worker', { ...ctx, log, span, schedule: scheduler.schedule });
  // The same object ctx.health adds to, so a later registration still shows.
  const checks = Object.assign(input.base.checks ?? {}, scheduler.checks());
  return { mount: () => undefined, checks, start: scheduler.start, stop: scheduler.stop };
};

export const MOUNTS: Record<HostPartKind, (input: RunnerInput) => Promise<PartMount>> = {
  api,
  mcp,
  worker,
};
