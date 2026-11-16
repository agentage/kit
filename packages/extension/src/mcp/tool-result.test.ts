import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { startTestMcp, type TestServer } from '../testing/test-server.js';
import { toolResult, type McpContext } from './tools.js';

const input = z.object({});
const output = z.object({ path: z.string() });
const MARKDOWN = '# notes/a.md\n\nSaved.';

// Production memory tools: markdown text beside the typed object; refusals as text only.
const memory = (ctx: McpContext) => {
  ctx.tool('write', { description: 'Write', input, output }, () =>
    toolResult(MARKDOWN, { structured: { path: 'notes/a.md' } })
  );
  ctx.tool('textonly', { description: 'Text only', input }, () => toolResult(MARKDOWN));
  ctx.tool('missing', { description: 'Missing', input, output }, () =>
    toolResult('No memory at path "x".', { isError: true })
  );
  ctx.tool('wrong', { description: 'Wrong', input, output }, () =>
    toolResult(MARKDOWN, { structured: { path: 5 } as unknown as { path: string } })
  );
  ctx.tool(
    'content',
    { description: 'Has a content key', input, output: z.object({ content: z.string() }) },
    () => ({
      content: 'mine',
    })
  );
};

let server: TestServer | undefined;
afterEach(async () => server?.close());

const call = async (name: string) => {
  const ctx = createTestContext({ extension: { id: 'memory', version: '0.1.0' } });
  server = await startTestMcp({ create: memory, ctx });
  const res = await server.fetch('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: `memory__${name}`, arguments: {} },
    }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return (JSON.parse(line ? line.slice(5) : text) as { result: Record<string, unknown> }).result;
};

describe('a tool that sends its own text (toolResult)', () => {
  it('answers its markdown as the text and the parsed output as structuredContent', async () => {
    expect(await call('write')).toEqual({
      content: [{ type: 'text', text: MARKDOWN }],
      structuredContent: { path: 'notes/a.md' },
    });
  });

  it('with no output schema answers the text only', async () => {
    expect(await call('textonly')).toEqual({ content: [{ type: 'text', text: MARKDOWN }] });
  });

  it('an own error is isError with its text only, no structuredContent', async () => {
    expect(await call('missing')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'No memory at path "x".' }],
    });
  });

  it('a structured part off the output schema is INTERNAL', async () => {
    const result = await call('wrong');
    expect(result['isError']).toBe(true);
    expect(result['content']).toEqual([{ type: 'text', text: 'Internal error' }]);
  });

  it('a plain output with its own content key is still the JSON of the output', async () => {
    expect(await call('content')).toEqual({
      content: [{ type: 'text', text: '{"content":"mine"}' }],
      structuredContent: { content: 'mine' },
    });
  });
});
