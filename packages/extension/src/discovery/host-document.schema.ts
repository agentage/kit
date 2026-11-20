import { z } from 'zod';
import {
  CommitSchema,
  ExtensionIdSchema,
  PackageNameSchema,
  VersionSchema,
} from '../manifest/primitives.schema.js';
import { ToolRecordSchema, TOOLS_RULE, toolsAreOwn } from './discovery.schema.js';
import { APP_ROW_RULE, appRowFits, AppRowSchema, SERVES_KINDS } from './served.schema.js';

export const HOST_KINDS = ['local', 'cloud'] as const;

// down: the installation lists it and no container answered with a valid document.
export const ENTRY_STATES = ['running', 'starting', 'failed', 'disabled', 'down'] as const;

const ServedExposeSchema = z.enum(['public', 'internal']);

// A part not named is off; app and pages are for the internet or not at all.
export const ExposeSchema = z.strictObject({
  mcp: ServedExposeSchema.optional(),
  api: ServedExposeSchema.optional(),
  app: z.literal('public').optional(),
  pages: z.literal('public').optional(),
});

export const ExtensionEntrySchema = z
  .strictObject({
    id: ExtensionIdSchema,
    version: VersionSchema,
    commit: CommitSchema.optional(),
    parts: z.array(z.enum(SERVES_KINDS)),
    tools: z.array(ToolRecordSchema).min(1).optional(),
    openapi: z
      .string()
      .regex(/^\/api\/[a-z][a-z0-9-]*\/openapi\.json$/)
      .optional(),
    app: AppRowSchema.optional(),
    expose: ExposeSchema,
    state: z.enum(ENTRY_STATES),
  })
  .refine(({ id, parts, app }) => appRowFits({ id, serves: parts, app }), APP_ROW_RULE)
  .refine(({ id, openapi }) => !openapi || openapi === `/api/${id}/openapi.json`, {
    message: 'openapi is /api/{id}/openapi.json',
    path: ['openapi'],
  })
  .refine(toolsAreOwn, TOOLS_RULE);

// The shell is a library the host serves: named here only, never a row of extensions.
const ShellSchema = z.strictObject({ package: PackageNameSchema, version: VersionSchema });

// The app host program that serves this document (a cloud host); the daemon leaves it out.
export const ProgramSchema = z.strictObject({ version: VersionSchema, commit: CommitSchema });

const uniqueIds = ({ extensions }: { extensions: { id: string }[] }) =>
  new Set(extensions.map((e) => e.id)).size === extensions.length;

// GET /.well-known/agentage-host.json: one app host, built from the documents of its extensions.
export const HostDocumentSchema = z
  .strictObject({
    host: z
      .string()
      .max(63)
      .regex(/^[a-z][a-z0-9-]*$/),
    kind: z.enum(HOST_KINDS),
    program: ProgramSchema.optional(),
    shell: ShellSchema.optional(),
    extensions: z.array(ExtensionEntrySchema),
  })
  .refine(uniqueIds, { message: 'one entry for each id', path: ['extensions'] });

export type HostDocument = z.infer<typeof HostDocumentSchema>;
export type HostEntry = HostDocument['extensions'][number];
export type HostKind = (typeof HOST_KINDS)[number];
export type Expose = z.infer<typeof ExposeSchema>;
export type Program = z.infer<typeof ProgramSchema>;
