import { z } from 'zod';
import {
  CommandNameSchema,
  CommitSchema,
  ExtensionIdSchema,
  IMAGE_PART_KINDS,
  PrefixedToolNameSchema,
  SecretNameSchema,
  SecretPartSchema,
  StoreKindSchema,
  VersionSchema,
} from '../manifest/primitives.schema.js';

// registry host[:port]/owner/{id}-{part}@sha256: deployed by digest, a version's images never change.
const ImageDigestRefSchema = z
  .string()
  .max(256)
  .regex(
    /^[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?\/[a-z0-9][a-z0-9-]*\/[a-z][a-z0-9-]*-(pages|ui|api|mcp|worker)@sha256:[0-9a-f]{64}$/
  );

const PartImageSchema = z.strictObject({ image: ImageDigestRefSchema });

const PartsRecordSchema = z
  .strictObject({
    pages: PartImageSchema.optional(),
    ui: PartImageSchema.optional(),
    api: PartImageSchema.optional(),
    mcp: PartImageSchema.optional(),
    worker: PartImageSchema.optional(),
    store: z
      .strictObject({ kind: StoreKindSchema, migrations: z.int().min(0).optional() })
      .optional(),
  })
  .refine((parts) => IMAGE_PART_KINDS.some((kind) => parts[kind] !== undefined), {
    message: 'at least one part with an image',
  });

export const OriginSchema = z
  .string()
  .max(270)
  .regex(
    /^(https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/
  );

export const WidgetSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  element: z.string().regex(/^[a-z][a-z0-9]*-[a-z0-9-]+$/),
  module: z.string().regex(/^\/ui\/[^/]+\/[^/]+\.m?js$/),
});

const ToolRecordSchema = z.strictObject({
  name: PrefixedToolNameSchema,
  scope: z.string().regex(/^(public|[a-z][a-z0-9-]*:(read|write|admin))$/),
});

const recordShape = {
  id: ExtensionIdSchema,
  version: VersionSchema,
  commit: CommitSchema,
  buildTime: z.iso.datetime(),
  parts: PartsRecordSchema,
  // /api/v{N}: an extension still on a kit before 0.13, read by a newer one; it goes in phase 4.
  openapi: z
    .string()
    .regex(/^\/api\/(?:v[0-9]+|[a-z][a-z0-9-]*)\/openapi\.json$/)
    .optional(),
  tools: z.array(ToolRecordSchema).min(1).optional(),
  widgets: z.array(WidgetSchema).min(1).optional(),
  commands: z.array(CommandNameSchema).min(1).optional(),
};

const imagesNameTheirExtension = (doc: { id: string; parts: z.infer<typeof PartsRecordSchema> }) =>
  IMAGE_PART_KINDS.every((kind) => {
    const image = doc.parts[kind]?.image;
    return image === undefined || image.includes(`/${doc.id}-${kind}@sha256:`);
  });

const IMAGE_RULE = { message: 'every image is {id}-{part}', path: ['parts'] };

// The api prefix is /api/{id}, or the old /api/v{N}: never another extension's id.
const openapiNamesItsExtension = ({ id, openapi }: { id: string; openapi?: string }) =>
  !openapi || /^\/api\/v[0-9]+\//.test(openapi) || openapi === `/api/${id}/openapi.json`;

const OPENAPI_RULE = { message: 'openapi is /api/{id}/openapi.json', path: ['openapi'] };

// A scoped name lives only in secretParts, so an estate that does not read it mounts nothing.
const scoped = (name: string) =>
  `secret ${name}: one or more parts, none repeated, and never also in secrets`;

// The build record: written by `build --push` into the package and the release asset; no host.
// Secret names and scoped parts are for the estate's mounts only; discovery leaves them out.
export const ExtensionRecordSchema = z
  .strictObject({
    ...recordShape,
    secrets: z.array(SecretNameSchema).min(1).optional(),
    secretParts: z.record(SecretNameSchema, z.array(SecretPartSchema)).optional(),
  })
  .refine(imagesNameTheirExtension, IMAGE_RULE)
  .refine(openapiNamesItsExtension, OPENAPI_RULE)
  .superRefine((doc, ctx) => {
    for (const [name, parts] of Object.entries(doc.secretParts ?? {}))
      if (!parts.length || new Set(parts).size !== parts.length || doc.secrets?.includes(name))
        ctx.addIssue({ code: 'custom', path: ['secretParts', name], message: scoped(name) });
  });

// What a deployment serves at /.well-known/agentage-extension.json: the record plus its host.
export const DiscoveryDocumentSchema = z
  .strictObject({ ...recordShape, host: OriginSchema })
  .refine(imagesNameTheirExtension, IMAGE_RULE)
  .refine(openapiNamesItsExtension, OPENAPI_RULE);

export type ExtensionRecord = z.infer<typeof ExtensionRecordSchema>;
export type DiscoveryDocument = z.infer<typeof DiscoveryDocumentSchema>;
