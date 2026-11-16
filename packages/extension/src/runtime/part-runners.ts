import { join } from 'node:path';
import { type Express } from 'express';
import { createPagesApp, platformSources } from '../pages/pages-app.js';
import { type PagesSite } from '../pages/pages.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { createPartApp } from '../server/app.js';
import { createUiApp } from '../ui/ui-app.js';
import { callCreate, MOUNTS, type RunnerInput } from './part-mounts.js';

export { type RunnerInput } from './part-mounts.js';

export interface Running {
  app: Express;
  stop?: () => void;
}

// One part in its own image: the part's mount on the kit app.
const own = (part: 'api' | 'mcp') => async (input: RunnerInput) => {
  const { mount } = await MOUNTS[part](input);
  return { app: createPartApp({ ...input.base, part, mount }) };
};

const pages = async (input: RunnerInput): Promise<Running> => {
  const site = (await callCreate(input, 'pages', input.ctx())) as PagesSite;
  return { app: createPagesApp({ ...input.base, site, platform: platformSources(input.env) }) };
};

const ui = async (input: RunnerInput): Promise<Running> => ({
  app: createUiApp({
    ...input.base,
    dir: join(input.dir, 'dist', 'ui'),
    devIssuer: input.env['AGENTAGE_DEV_ISSUER'],
  }),
});

const worker = async (input: RunnerInput): Promise<Running> => {
  const { mount, checks, start, stop } = await MOUNTS.worker(input);
  start?.();
  return { app: createPartApp({ ...input.base, checks, part: 'worker', mount }), stop };
};

export const RUNNERS: Record<ImagePartKind, (input: RunnerInput) => Promise<Running>> = {
  api: own('api'),
  mcp: own('mcp'),
  pages,
  ui,
  worker,
};
