import { type Request, type Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ApiContext } from '../api/routes.js';
import { type McpContext } from '../mcp/tools.js';
import { startTestMcp, startTestServer, type TestServer } from './test-server.js';

let server: TestServer | undefined;
afterEach(async () => server?.close());

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('the test servers serve ctx.files and ctx.connector', () => {
  it('startTestServer: /files/{id}/* reaches ctx.files with the caller', async () => {
    const create = (ctx: ApiContext) =>
      ctx.files((req: Request, res: Response) => void res.json(ctx.auth.caller(req)?.sub ?? null));
    server = await startTestServer({ create, caller: { sub: 'u_1', scopes: ['test:write'] } });
    const res = await server.fetch(
      '/files/test/u_1/default.git/info/refs?service=git-receive-pack'
    );
    expect([res.status, await res.json()]).toEqual([200, 'u_1']);
  });

  it('startTestMcp: /connector lists the connector tools by their own name', async () => {
    const create = (ctx: McpContext) =>
      ctx.connector('fetch', { description: 'Fetch', input: z.object({}) }, () => ({}));
    server = await startTestMcp({ create });
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const res = await server.fetch('/connector', { method: 'POST', headers: MCP, body });
    expect(await res.text()).toContain('"name":"fetch"');
  });
});
