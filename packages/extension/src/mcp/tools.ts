import { type z } from 'zod';
import { ACCESS, badScope, type Access, type Caller } from '../auth/token-check.js';
import { type PartContext } from '../context/context.js';

type ObjectSchema = z.ZodObject;

// The MCP tool hints, typed here: the tool entry (check) loads no server dependency.
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec<I extends ObjectSchema, O extends ObjectSchema> {
  title?: string;
  description: string;
  input: I;
  // Left out: the result is text only, no structuredContent.
  output?: O;
  annotations?: ToolAnnotations;
  // What tools/call needs: {id}:{scope}, or public; read when left out (optional is routes only).
  scope?: Exclude<Access, 'optional'>;
}

export interface TextContent {
  type: 'text';
  text: string;
}

// A registry symbol, so a result made by a second copy of the kit is still recognised.
const TOOL_RESULT = Symbol.for('agentage.extension.tool-result');

export interface ToolResult<T = unknown> {
  readonly [TOOL_RESULT]: true;
  content: TextContent[];
  structuredContent?: T;
  isError?: true;
}

export interface ToolResultOptions<T> {
  // Parsed by the output schema; dropped when the tool declares none.
  structured?: T;
  // The text alone goes out as the tool error: no structuredContent, no agcid.
  isError?: true;
}

// What a tool returns to send its own text (markdown) in place of the kit's JSON of the output.
export const toolResult = <T = never>(
  text: string | TextContent[],
  options: ToolResultOptions<T> = {}
): ToolResult<T> => ({
  [TOOL_RESULT]: true,
  content: typeof text === 'string' ? [{ type: 'text', text }] : text,
  ...(options.structured !== undefined && { structuredContent: options.structured }),
  ...(options.isError && { isError: true }),
});

export const isToolResult = (value: unknown): value is ToolResult =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<symbol, unknown>)[TOOL_RESULT] === true;

type Answer<O extends ObjectSchema> = z.input<O> | ToolResult<z.input<O>>;

// The caller is null with no token check (a daemon child) or on a public tool.
export type ToolHandler<I extends ObjectSchema, O extends ObjectSchema> = (
  args: z.output<I>,
  caller: Caller | null
) => Answer<O> | Promise<Answer<O>>;

// Registers a tool under its own name; the kit serves it as {id}__{name}.
export type ToolRegistrar = <I extends ObjectSchema, O extends ObjectSchema>(
  name: string,
  spec: ToolSpec<I, O>,
  handler: ToolHandler<I, O>
) => void;

// What initialize tells the model: one text, or one per caller (production names the caller's vaults).
export type Instructions = string | ((caller: Caller | null) => string | Promise<string>);

export interface McpContext extends PartContext {
  readonly tool: ToolRegistrar;
  readonly instructions: (instructions: Instructions) => void;
  // A tool of the connector profile at /connector/{id} (ChatGPT search and fetch), named as given.
  readonly connector: ToolRegistrar;
}

export interface ToolEntry {
  name: string;
  spec: ToolSpec<ObjectSchema, ObjectSchema>;
  handler: (args: Record<string, unknown>, caller: Caller | null) => unknown;
}

const TOOL_NAME = /^[a-z][a-z0-9_-]*$/;
const TOOL_ACCESS = ACCESS.filter((access) => access !== 'optional');

const registrarOn =
  (tools: ToolEntry[]): ToolRegistrar =>
  (name, spec, handler) => {
    if (!TOOL_NAME.test(name)) throw new Error(`tool name ${name}: lowercase, digits, _ and -`);
    if (tools.some((entry) => entry.name === name))
      throw new Error(`tool ${name} is registered twice`);
    if (!spec.description) throw new Error(`tool ${name} needs a description: it routes the model`);
    const bad = badScope(spec.scope, TOOL_ACCESS);
    if (bad) throw new Error(`tool ${name} ${bad}`);
    tools.push({ name, spec, handler: handler as ToolEntry['handler'] });
  };

export const createToolRegistry = () => {
  const tools: ToolEntry[] = [];
  const connectors: ToolEntry[] = [];
  const served: { instructions?: Instructions } = {};
  const instructions = (value: Instructions) => {
    if (served.instructions !== undefined) throw new Error('instructions are set twice');
    served.instructions = value;
  };
  const [tool, connector] = [registrarOn(tools), registrarOn(connectors)];
  return { tool, tools, instructions, served, connector, connectors };
};

export const prefixed = (id: string, name: string): string => `${id}__${name}`;

// A connector tool keeps its own name (search, fetch); every other is {id}__{name}.
export const nameOf = (id: string, name: string, bare?: boolean): string =>
  bare ? name : prefixed(id, name);
