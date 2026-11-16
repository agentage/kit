import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type Caller, type TokenCheck } from '../auth/token-check.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { createMcpApp } from './mcp-app.js';
import { callTool, mcpSnapshot } from './snapshot.js';
import { createToolRegistry, type Instructions } from './tools.js';

const BUILD = { commit: '0'.repeat(40), buildTime: '2026-11-16T10:00:00Z' };
const PKG = { ...API_MANIFEST, agentage: { id: 'memory', parts: { mcp: true } } };
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2025-11-25',
};

// memory__write in the production snapshot (agentage-old/web packages/memory-mcp/.mcpc.json).
const WRITE_TITLE = 'Save to your memory';
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// A bearer names its user; no bearer is anonymous, as a check of public or optional answers.
const byBearer: TokenCheck = async (authorization) =>
  authorization ? { sub: authorization.slice(7), scopes: ['memory:write'] } : null;

let served: Served | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

const start = async (instructions?: Instructions, tokenCheck?: TokenCheck) => {
  const { tool, tools } = createToolRegistry();
  const input = z.object({});
  const output = z.object({ sub: z.string().nullable() });
  const spec = { description: 'Save', input, output, title: WRITE_TITLE };
  tool('write', { ...spec, annotations: WRITE_ANNOTATIONS }, (_args, caller) => ({
    sub: caller?.sub ?? null,
  }));
  tool('plain', { description: 'Plain', input, output }, () => ({ sub: null }));
  tool('text', { description: 'Text only', input }, () => ({ said: 'hi' }));
  const log = recordedLog().log;
  const options = { pkg: PKG, build: BUILD, log, tools, listing: 'open' as const };
  served = await serveApp(createMcpApp({ ...options, instructions, tokenCheck }));
  return `${served.url}/mcp`;
};

const dataOf = async (res: Response) => {
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5) : text) as { result: Record<string, unknown> };
};

const initialize = async (url: string, bearer?: string) => {
  const auth: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {};
  const params = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT };
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params });
  const res = await fetch(url, { method: 'POST', headers: { ...HEADERS, ...auth }, body });
  return (await dataOf(res)).result['instructions'];
};
const CLIENT = { name: 't', version: '1' };

const toolNamed = async (url: string, name: string) =>
  (await mcpSnapshot(url, '2025-11-25')).tools.find((t) => t['name'] === name);

describe('mcp tool fields (G7)', () => {
  it('lists title and annotations as the production snapshot has them, no SDK defaults', async () => {
    const write = await toolNamed(await start(), 'memory__write');
    expect(write?.['title']).toBe(WRITE_TITLE);
    expect(write?.['annotations']).toEqual(WRITE_ANNOTATIONS);
  });

  it('lists a tool that sets neither field with no title, no annotations', async () => {
    const plain = await toolNamed(await start(), 'memory__plain');
    expect(Object.keys(plain ?? {}).sort()).toEqual([
      'description',
      'inputSchema',
      'name',
      'outputSchema',
    ]);
  });

  it('a tool with no output lists no outputSchema and answers text only', async () => {
    const url = await start();
    expect((await toolNamed(url, 'memory__text'))?.['outputSchema']).toBeUndefined();
    expect(await callTool(url, 'memory__text', {})).toBeUndefined();
  });
});

describe('the caller in the tool handler', () => {
  it('is the checked caller of the request', async () => {
    const url = await start(undefined, byBearer);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...HEADERS, authorization: 'Bearer u_alice' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'memory__write', arguments: {} },
      }),
    });
    expect((await dataOf(res)).result['structuredContent']).toEqual({ sub: 'u_alice' });
  });

  it('is null with no token check (a daemon child)', async () => {
    expect(await callTool(await start(), 'memory__write', {})).toEqual({ sub: null });
  });
});

describe('server instructions', () => {
  it('a text goes to initialize as it is', async () => {
    expect(await initialize(await start('Use memory__write to save.'))).toBe(
      'Use memory__write to save.'
    );
  });

  it('a function gets the caller of initialize, or null with no bearer', async () => {
    const per = (caller: Caller | null) => `vaults of ${caller?.sub ?? 'nobody'}`;
    const url = await start(per, byBearer);
    expect(await initialize(url, 'u_bob')).toBe('vaults of u_bob');
    expect(await initialize(url)).toBe('vaults of nobody');
  });

  it('is set once', () => {
    const { instructions } = createToolRegistry();
    instructions('one');
    expect(() => instructions('two')).toThrow('instructions are set twice');
  });
});
