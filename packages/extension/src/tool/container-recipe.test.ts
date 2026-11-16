import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { containerRecipe } from './container-recipe.js';

// Runs the recipe's own HEALTHCHECK command with PORT set to a server answering `status`.
const healthcheckExit = async (recipe: string, status: number): Promise<unknown> => {
  const line = recipe.split('\n').find((l) => l.startsWith('HEALTHCHECK')) ?? '';
  const server = createServer((_req, res) => void res.writeHead(status).end());
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const { port } = server.address() as AddressInfo;
  const [, ...args] = JSON.parse(line.slice(line.indexOf('CMD ') + 4)) as string[];
  const env = { ...process.env, PORT: String(port) };
  const [code] = await once(spawn(process.execPath, args, { env }), 'exit');
  server.close();
  return code;
};

const runnerOf = (recipe: string) => recipe.slice(recipe.indexOf('AS runner'));

describe('container recipe', () => {
  const store = containerRecipe({ pglite: '0.5.16' });
  const plain = containerRecipe({});

  it('is multi-stage node:26-alpine with production dependencies only', () => {
    expect(store.split('\n').filter((line) => line.startsWith('FROM '))).toEqual([
      'FROM node:26-alpine AS deps',
      'FROM node:26-alpine AS pglite',
      'FROM node:26-alpine AS runner',
    ]);
    expect(store).toContain('RUN npm ci --omit=dev');
  });

  it('runs the kit host as node, on every address, with COMMIT_SHA and BUILD_TIME as ENV', () => {
    const runner = runnerOf(plain);
    for (const line of ['ARG COMMIT_SHA', 'ARG BUILD_TIME', 'USER node', 'EXPOSE 8080'])
      expect(runner).toContain(line);
    for (const env of [
      'PORT=8080',
      'AGENTAGE_HOST_BIND=all',
      'AGENTAGE_DRAIN_MS=8000',
      'COMMIT_SHA=$COMMIT_SHA',
    ])
      expect(runner).toContain(env);
    expect(runner).toContain('BUILD_TIME=$BUILD_TIME');
    expect(runner).not.toContain('AGENTAGE_HOST_AUTH');
    expect(runner.trim().split('\n').at(-1)).toBe(
      'CMD ["node", "node_modules/@agentage/extension/dist/host/main.js"]'
    );
  });

  it('a postgres store brings PGlite and a /data volume the node user owns', () => {
    const runner = runnerOf(store);
    expect(store).toContain(
      'npm install --no-audit --no-fund --no-package-lock @electric-sql/pglite@0.5.16'
    );
    expect(runner).toContain('AGENTAGE_DATA_DIR=/data/store');
    const order = ['COPY --from=pglite', 'chown node:node /data', 'VOLUME /data', 'USER node'];
    const at = order.map((line) => runner.indexOf(line));
    expect(at.every((i, n) => i >= 0 && (n === 0 || i > (at[n - 1] ?? 0)))).toBe(true);
    for (const absent of ['pglite', 'VOLUME', 'AGENTAGE_DATA_DIR', 'apk add'])
      expect(plain).not.toContain(absent);
  });

  it('a git store brings the git binary and the /data volume, no PGlite', () => {
    const runner = runnerOf(containerRecipe({ git: true }));
    for (const line of [
      'RUN apk add --no-cache git',
      'AGENTAGE_DATA_DIR=/data/store',
      'VOLUME /data',
    ])
      expect(runner).toContain(line);
    expect(containerRecipe({ git: true })).not.toContain('pglite');
    expect(store).not.toContain('apk add');
  });

  it('HEALTHCHECK probes 127.0.0.1 at PORT: 200 and 503 pass, 404 fails', async () => {
    expect(store).toMatch(/HEALTHCHECK .*fetch\('http:\/\/127\.0\.0\.1:'\+\(process\.env\.PORT/);
    expect(await healthcheckExit(store, 200)).toBe(0);
    expect(await healthcheckExit(store, 503)).toBe(0);
    expect(await healthcheckExit(store, 404)).toBe(1);
  });
});
