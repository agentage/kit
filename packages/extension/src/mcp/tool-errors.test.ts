import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { fail } from '../envelope/envelope.js';
import { startTestMcp, type TestServer } from '../testing/test-server.js';
import { type McpContext } from './tools.js';

const input = z.object({});
const refuse = () => {
  throw fail('NOT_FOUND', 'No memory at path "x".');
};

const tools = (ctx: McpContext) => {
  ctx.tool('plain', { description: 'No output schema', input }, refuse);
  ctx.tool('typed', { description: 'Output schema', input, output: z.object({}) }, refuse);
  ctx.tool('crash', { description: 'Crash', input }, () => {
    throw new Error('secret detail');
  });
};

let server: TestServer | undefined;
afterEach(async () => server?.close());

const call = async (name: string, args: object = {}) => {
  const ctx = createTestContext({ extension: { id: 'memory', version: '0.1.0' } });
  server = await startTestMcp({ create: tools, ctx });
  const res = await server.fetch('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      agcid: '996898428ea33f8e0a9ba8b4e1eac9c0',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: `memory__${name}`, arguments: args },
    }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return (JSON.parse(line ? line.slice(5) : text) as { result: Record<string, unknown> }).result;
};

describe('a tool error and the output schema', () => {
  it('with no output schema is text only, as production sends it', async () => {
    expect(await call('plain')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'No memory at path "x".' }],
    });
    expect(await call('crash')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Internal error' }],
    });
  });

  it('with an output schema keeps structuredContent.error (the widget reads its code)', async () => {
    expect((await call('typed'))['structuredContent']).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No memory at path "x".',
        agcid: '996898428ea33f8e0a9ba8b4e1eac9c0',
      },
    });
  });
});
