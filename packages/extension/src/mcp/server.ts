import { McpServer, type AuthInfo, type McpRequestContext } from '@modelcontextprotocol/server';
import { agcidOf } from '../agcid/agcid.js';
import { type Caller } from '../auth/token-check.js';
import { currentAgcid } from '../agcid/current.js';
import { fail, isFailure, type Failure } from '../envelope/envelope.js';
import { type Log } from '../log/log.js';
import {
  isToolResult,
  nameOf,
  type Instructions,
  type ToolEntry,
  type ToolResult,
} from './tools.js';

interface ServerIdentity {
  id: string;
  version: string;
  bare?: boolean;
}

const text = (value: string) => [{ type: 'text' as const, text: value }];

// A failed tool: isError, else INTERNAL; with an output schema also the REST error shape and an agcid.
const errorResult = (entry: ToolEntry, err: unknown, log: Log, tool: string) => {
  const failure: Failure = isFailure(err) ? err : fail('INTERNAL', 'Internal error');
  if (failure.status >= 500) log.error(err, tool);
  const content = text(failure.message);
  if (!entry.spec.output) return { isError: true, content };
  const error = { code: failure.code, message: failure.message, agcid: agcidOf(currentAgcid()) };
  return { isError: true, content, structuredContent: { error } };
};

// The kit, not the SDK, refuses bad arguments (C7): the SDK lists the schema, passes all through.
const listedOnly = (input: ToolEntry['spec']['input']) => ({
  '~standard': { ...input['~standard'], validate: (value: unknown) => ({ value }) },
});

const argsOf = (entry: ToolEntry, args: Record<string, unknown>) => {
  const parsed = entry.spec.input.safeParse(args);
  if (parsed.success) return parsed.data;
  const fields = new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'));
  throw fail('VALIDATION_ERROR', `Invalid arguments: ${[...fields].join(', ')}`);
};

// The tool's own text; its structured part still meets the output schema.
const ownResultOf = (entry: ToolEntry, { content, isError, structuredContent }: ToolResult) => {
  if (isError) return { isError, content };
  if (!entry.spec.output) return { content };
  const output = entry.spec.output.parse(structuredContent);
  return { content, structuredContent: output as Record<string, unknown> };
};

// No output schema: the answer is text only, as a client of a tool with no outputSchema expects.
const resultOf = (entry: ToolEntry, value: unknown) => {
  if (isToolResult(value)) return ownResultOf(entry, value);
  if (!entry.spec.output) return { content: text(JSON.stringify(value ?? null)) };
  const output = entry.spec.output.parse(value);
  return {
    content: text(JSON.stringify(output)),
    structuredContent: output as Record<string, unknown>,
  };
};

const callback =
  (entry: ToolEntry, log: Log, tool: string, caller: Caller | null) =>
  async (args: Record<string, unknown>) => {
    const start = performance.now();
    const ms = () => Math.round(performance.now() - start);
    try {
      const result = resultOf(entry, await entry.handler(argsOf(entry, args), caller));
      log.mcp({ tool, ms: ms() });
      return result;
    } catch (err) {
      // A 4xx is a rejection, not a failure: the row stays info.
      log.mcp({ tool, ms: ms(), ...(isFailure(err) && err.status < 500 ? {} : { error: err }) });
      return errorResult(entry, err, log, tool);
    }
  };

// The caller the guard checked rides in authInfo, the SDK's own path to a per-request server.
export const authInfoOf = (caller: Caller | null, opening: boolean): AuthInfo => ({
  token: '',
  clientId: caller?.sub ?? '',
  scopes: [...(caller?.scopes ?? [])],
  extra: { caller, opening },
});

const callerOf = (ctx?: McpRequestContext): Caller | null =>
  (ctx?.authInfo?.extra?.['caller'] as Caller | undefined) ?? null;

const isOpening = (ctx?: McpRequestContext): boolean => ctx?.authInfo?.extra?.['opening'] === true;

// Unset fields stay off the listing, so a tool that sets none lists as before.
const configOf = (spec: ToolEntry['spec']) => ({
  description: spec.description,
  inputSchema: listedOnly(spec.input),
  ...(spec.output && { outputSchema: spec.output }),
  ...(spec.title !== undefined && { title: spec.title }),
  ...(spec.annotations && { annotations: spec.annotations }),
});

// A function runs only for the opening message; its failure is logged and the opening has no text.
const textOf = async (
  instructions: Instructions | undefined,
  ctx: McpRequestContext | undefined,
  log: Log
) => {
  if (typeof instructions !== 'function') return instructions;
  if (!isOpening(ctx)) return undefined;
  try {
    return await instructions(callerOf(ctx));
  } catch (err) {
    log.error(err, 'instructions');
    return undefined;
  }
};

// One fresh server per request (stateless); serverInfo agentage-{id} at the package version.
export const serverFactory =
  (identity: ServerIdentity, tools: ToolEntry[], log: Log, instructions?: Instructions) =>
  async (ctx?: McpRequestContext) => {
    const caller = callerOf(ctx);
    const info = { name: `agentage-${identity.id}`, version: identity.version };
    const server = new McpServer(info, { instructions: await textOf(instructions, ctx, log) });
    for (const entry of tools) {
      const tool = nameOf(identity.id, entry.name, identity.bare);
      server.registerTool(tool, configOf(entry.spec), callback(entry, log, tool, caller));
    }
    return server;
  };
