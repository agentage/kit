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
import { APP_ROW_RULE, appRowFits, AppRowSchema, ServesSchema } from './served.schema.js';

// registry host[:port]/owner/{id}-{part}@sha256: deployed by digest, a version's images never change.
const ImageDigestRefSchema = z
  .string()
  .max(256)
  .regex(
    /^[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?\/[a-z0-9][a-z0-9-]*\/[a-z][a-z0-9-]*-(pages|ui|api|mcp|worker)@sha256:[0-9a-f]{64}$/
  );

const PartImageSchema = z.strictObject({ image: ImageDigestRefSchema });

// The one image: registry host[:port]/owner[/team...]/{id}@sha256.
const OneImageRefSchema = z
  .string()
  .max(256)
  .regex(
    /^[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?(\/[a-z0-9][a-z0-9_.-]*)+\/[a-z][a-z0-9-]*@sha256:[0-9a-f]{64}$/
  );

const StoreRecordSchema = z.strictObject({
  kind: StoreKindSchema,
  migrations: z.int().min(0).optional(),
});

const PartsRecordSchema = z.strictObject({
  pages: PartImageSchema.optional(),
  ui: PartImageSchema.optional(),
  api: PartImageSchema.optional(),
  mcp: PartImageSchema.optional(),
  worker: PartImageSchema.optional(),
  store: StoreRecordSchema.optional(),
});

// A part the kit host runs has no image: the host never knows its own digest.
const HostedPartSchema = z.strictObject({});

const ServedPartsSchema = z.strictObject({
  pages: PartImageSchema.optional(),
  ui: PartImageSchema.optional(),
  api: z.union([PartImageSchema, HostedPartSchema]).optional(),
  mcp: z.union([PartImageSchema, HostedPartSchema]).optional(),
  worker: z.union([PartImageSchema, HostedPartSchema]).optional(),
  store: StoreRecordSchema.optional(),
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

export const ToolRecordSchema = z.strictObject({
  name: PrefixedToolNameSchema,
  scope: z.string().regex(/^(public|[a-z][a-z0-9-]*:(read|write|admin))$/),
});

const recordShape = {
  id: ExtensionIdSchema,
  version: VersionSchema,
  commit: CommitSchema,
  buildTime: z.iso.datetime(),
  parts: PartsRecordSchema,
  image: OneImageRefSchema.optional().describe(
    'The one image (build --container). A build record has part images or this image: never both, never none.'
  ),
  // /api/v{N}: an extension still on a kit before 0.13, read by a newer one; it goes in phase 4.
  openapi: z
    .string()
    .regex(/^\/api\/(?:v[0-9]+|[a-z][a-z0-9-]*)\/openapi\.json$/)
    .describe(
      '/api/{id}/openapi.json, or the old /api/v{N}; only the kit checks that {id} is the id'
    )
    .optional(),
  tools: z.array(ToolRecordSchema).min(1).optional(),
  widgets: z.array(WidgetSchema).min(1).optional(),
  commands: z.array(CommandNameSchema).min(1).optional(),
};

type Imaged = {
  id: string;
  parts: Partial<Record<(typeof IMAGE_PART_KINDS)[number], { image?: string }>>;
  image?: string;
};

const imagesNameTheirExtension = (doc: Imaged) =>
  (!doc.image || doc.image.includes(`/${doc.id}@sha256:`)) &&
  IMAGE_PART_KINDS.every((kind) => {
    const image = doc.parts[kind]?.image;
    return image === undefined || image.includes(`/${doc.id}-${kind}@sha256:`);
  });

const IMAGE_RULE = { message: 'every image is {id}-{part}, the one image {id}', path: ['parts'] };

// One image per part, or the one image of every part (build --container): never both, never none.
const oneImageForm = (doc: Imaged) =>
  IMAGE_PART_KINDS.some((kind) => doc.parts[kind] !== undefined) !== Boolean(doc.image);

const FORM_RULE = {
  message: 'at least one part with an image, or the one image and no part image',
  path: ['parts'],
};

// Discovery also takes the kit host's form: one or more parts, none with an image, no one image.
const servedForm = (doc: Imaged) => {
  const bare = IMAGE_PART_KINDS.filter((kind) => doc.parts[kind] && !doc.parts[kind].image);
  if (!bare.length) return oneImageForm(doc);
  return !doc.image && IMAGE_PART_KINDS.every((kind) => doc.parts[kind]?.image === undefined);
};

const HOSTED_RULE = {
  message: 'at least one part with an image, the one image, or only parts with no image',
  path: ['parts'],
};

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
  .refine(oneImageForm, FORM_RULE)
  .refine(imagesNameTheirExtension, IMAGE_RULE)
  .refine(openapiNamesItsExtension, OPENAPI_RULE)
  .superRefine((doc, ctx) => {
    for (const [name, parts] of Object.entries(doc.secretParts ?? {}))
      if (!parts.length || new Set(parts).size !== parts.length || doc.secrets?.includes(name))
        ctx.addIssue({ code: 'custom', path: ['secretParts', name], message: scoped(name) });
  });

// The record as served: its host, the parts this container answers for and the app nav row.
const servedShape = { host: OriginSchema, serves: ServesSchema, app: AppRowSchema.optional() };

// What a deployment serves at /.well-known/agentage-extension.json.
export const DiscoveryDocumentSchema = z
  .strictObject({ ...recordShape, parts: ServedPartsSchema, ...servedShape })
  .refine(servedForm, HOSTED_RULE)
  .refine(appRowFits, APP_ROW_RULE)
  .refine(imagesNameTheirExtension, IMAGE_RULE)
  .refine(openapiNamesItsExtension, OPENAPI_RULE);

// The form the cloud serves: every part by its image, or the one image; never a part with no image.
export const CloudDiscoveryDocumentSchema = z
  .strictObject({ ...recordShape, ...servedShape })
  .refine(oneImageForm, FORM_RULE)
  .refine(appRowFits, APP_ROW_RULE)
  .refine(imagesNameTheirExtension, IMAGE_RULE)
  .refine(openapiNamesItsExtension, OPENAPI_RULE);

export type ExtensionRecord = z.infer<typeof ExtensionRecordSchema>;
export type DiscoveryDocument = z.infer<typeof DiscoveryDocumentSchema>;
