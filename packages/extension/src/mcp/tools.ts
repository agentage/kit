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

// The caller is null with no token check (a daemon child) or on a public tool.
export type ToolHandler<I extends ObjectSchema, O extends ObjectSchema> = (
  args: z.output<I>,
  caller: Caller | null
) => z.input<O> | Promise<z.input<O>>;

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
}

export interface ToolEntry {
  name: string;
  spec: ToolSpec<ObjectSchema, ObjectSchema>;
  handler: (args: Record<string, unknown>, caller: Caller | null) => unknown;
}

const TOOL_NAME = /^[a-z][a-z0-9_-]*$/;
const TOOL_ACCESS = ACCESS.filter((access) => access !== 'optional');

export const createToolRegistry = () => {
  const tools: ToolEntry[] = [];
  const tool: ToolRegistrar = (name, spec, handler) => {
    if (!TOOL_NAME.test(name)) throw new Error(`tool name ${name}: lowercase, digits, _ and -`);
    if (tools.some((entry) => entry.name === name))
      throw new Error(`tool ${name} is registered twice`);
    if (!spec.description) throw new Error(`tool ${name} needs a description: it routes the model`);
    const bad = badScope(spec.scope, TOOL_ACCESS);
    if (bad) throw new Error(`tool ${name} ${bad}`);
    tools.push({ name, spec, handler: handler as ToolEntry['handler'] });
  };
  const served: { instructions?: Instructions } = {};
  const instructions = (value: Instructions) => {
    if (served.instructions !== undefined) throw new Error('instructions are set twice');
    served.instructions = value;
  };
  return { tool, tools, instructions, served };
};

export const prefixed = (id: string, name: string): string => `${id}__${name}`;
