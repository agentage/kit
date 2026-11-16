import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { requestScope } from '../agcid/current.js';
import { setCaller, strongest, type Access, type Caller } from '../auth/token-check.js';
import { fail } from '../envelope/envelope.js';
import { declaredType, printable } from '../log/who.js';
import { BODY_LIMIT, createPartApp, PUBLIC_CORS, type PartAppBase } from '../server/app.js';
import { authInfoOf, serverFactory } from './server.js';
import { prefixed, type Instructions, type ToolEntry } from './tools.js';

export interface McpAppOptions extends PartAppBase {
  tools: ToolEntry[];
  listing: 'open' | 'token';
  instructions?: Instructions;
  // Where the endpoint is: /mcp in a part image, /mcp/{id} in a host process.
  paths?: string[];
}

const MCP_PATH = '/mcp';

// The endpoint of an extension on a host that runs many: the daemon routes it to its child.
export const mcpPathOf = (id: string): string => `${MCP_PATH}/${id}`;

const MCP_HEADERS = ['Mcp-Protocol-Version', 'Mcp-Method', 'Mcp-Name', 'Accept'];
const MCP_CORS = {
  ...PUBLIC_CORS,
  allowedHeaders: [...(PUBLIC_CORS.allowedHeaders as string[]), ...MCP_HEADERS],
};

const PARSE_ERROR = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null };

const parsed = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
};

interface Message {
  method?: unknown;
  params?: { name?: unknown; clientInfo?: { name?: unknown } };
}

const messagesOf = (body: unknown): (Message | null)[] =>
  (Array.isArray(body) ? body : [body]) as (Message | null)[];

const isListing = (body: unknown): boolean =>
  messagesOf(body).some((message) => message?.method === 'tools/list');

// Each tools/call needs its tool's declared scope (read when it declares none).
const callAccess = (options: McpAppOptions, body: unknown): Access[] =>
  messagesOf(body)
    .filter((message) => message?.method === 'tools/call')
    .map((message) => {
      const id = options.pkg.agentage.id;
      const entry = options.tools.find((t) => prefixed(id, t.name) === message?.params?.name);
      return entry?.spec.scope ?? 'read';
    });

const OPENING = new Set(['initialize', 'server/discover']);

// Instructions made per caller: the opening message reads a bearer when one is sent.
const openingAccess = (options: McpAppOptions, body: unknown): Access[] =>
  typeof options.instructions === 'function' &&
  messagesOf(body).some((message) => OPENING.has(String(message?.method)))
    ? ['optional']
    : [];

// Tokens off: calls stay anonymous and a closed listing refuses every tools/list (nothing can verify).
const guard = async (options: McpAppOptions, req: Request, body: unknown) => {
  const listing = options.listing === 'token' && isListing(body) ? (['read'] as Access[]) : [];
  const needed = [...listing, ...callAccess(options, body), ...openingAccess(options, body)];
  if (!options.tokenCheck) {
    if (listing.length > 0) throw fail('UNAUTHORIZED', 'tools/list needs a token');
    return null;
  }
  if (needed.length === 0) return null;
  const caller: Caller | null = await options.tokenCheck(
    req.get('authorization'),
    strongest(needed)
  );
  setCaller(req, caller);
  return caller;
};

// A tools/call leaves its mcp row and no http row (Q1); initialize names the client (Q14).
const markRow = (options: McpAppOptions, req: Request, res: Response, body: unknown): void => {
  const messages = messagesOf(body);
  const scope = requestScope.getStore();
  const id = options.pkg.agentage.id;
  const known = (m: Message | null) =>
    options.tools.some((t) => prefixed(id, t.name) === m?.params?.name);
  // An unknown tool never reaches a handler, so it keeps its http row.
  if (messages.some((m) => m?.method === 'tools/call' && known(m))) {
    res.locals['toolCall'] = true;
    if (scope) scope.user_type = declaredType((name) => req.get(name)) ?? 'agent';
  }
  const name = messages.find((m) => m?.method === 'initialize')?.params?.clientInfo?.name;
  if (typeof name === 'string') res.locals['clientInfo'] = printable(name).slice(0, 64);
};

const webRequest = (req: Request, body: Buffer): globalThis.Request => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  return new globalThis.Request(`http://${req.get('host') ?? 'mcp'}/mcp`, {
    method: 'POST',
    headers,
    body,
  });
};

const send = async (response: globalThis.Response, res: Response, auth: boolean) => {
  res.status(response.status);
  response.headers.forEach(
    (value, key) => void (key !== 'set-cookie' && res.setHeader(key, value))
  );
  // After the SDK headers: its SSE answer sets no-cache, which a token-checked answer overrides.
  if (auth) res.setHeader('Cache-Control', 'no-store');
  if (!response.body) return void res.end();
  await pipeline(Readable.fromWeb(response.body as never), res);
};

const handle =
  (handler: McpHttpHandler, options: McpAppOptions) =>
  async (req: Request, res: Response): Promise<void> => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const message = parsed(body);
    // The SDK reads a body again when given none (a BOM, say): it must only run what guard read.
    if (message === undefined) return void res.status(400).json(PARSE_ERROR);
    const caller = await guard(options, req, message);
    markRow(options, req, res, message);
    const authInfo = caller ? authInfoOf(caller) : undefined;
    const answer = await handler.fetch(webRequest(req, body), { parsedBody: message, authInfo });
    await send(answer, res, caller !== null);
  };

const methodNotAllowed = (_req: Request, res: Response): void => {
  res.setHeader('Allow', 'POST');
  res
    .status(405)
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
};

// Stateless Streamable HTTP on SDK v2: POST only, GET and DELETE (sessions) answer 405.
export const mountMcp = (app: Express, options: McpAppOptions): void => {
  const identity = { id: options.pkg.agentage.id, version: options.pkg.version };
  const factory = serverFactory(identity, options.tools, options.log, options.instructions);
  const handler = createMcpHandler(factory, {
    legacy: 'stateless',
    onerror: (err) => options.log.warn('mcp request refused', { reason: err.message }),
  });
  const raw = express.raw({ type: () => true, limit: BODY_LIMIT });
  for (const path of options.paths ?? [MCP_PATH]) {
    app.use(path, cors(MCP_CORS));
    app.post(path, raw, handle(handler, options));
    app.all(path, methodNotAllowed);
  }
};

export const createMcpApp = (options: McpAppOptions): Express =>
  createPartApp({ ...options, part: 'mcp', mount: (app) => mountMcp(app, options) });
