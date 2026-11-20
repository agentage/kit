import { z } from 'zod';
import { ExposeSchema, PackageNameSchema, VersionSchema } from '@agentage/extension/internal';

// C2, the cloud form of installation.json: the one schema of the start and of --check.
const NAME = /^[a-z][a-z0-9-]*$/;
const MACHINE_ONLY = 'is for a machine only, not a cloud app host';

const required = (message: string) => (i: { input: unknown }) =>
  i.input === undefined ? message : undefined;
const machineOnly = z.never({ error: MACHINE_ONLY }).optional();

const RowSchema = z.strictObject({
  id: z.string().max(48).regex(NAME),
  version: z.string({ error: required('is required in a cloud app host') }).pipe(VersionSchema),
  source: machineOnly,
  enabled: machineOnly,
  store: z.enum(['postgres', 'git', 'clickhouse', 'sqlite']).optional(),
  track: z.literal('latest').optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  expose: ExposeSchema.optional(),
});

const ShellSchema = z.strictObject({
  package: PackageNameSchema,
  version: z.never({ error: 'is gone: the program carries the shell version' }).optional(),
  title: z.string().max(64).optional(),
  home: z.string().regex(/^\//).optional(),
});

const ProgramSchema = z.strictObject(
  { version: VersionSchema },
  { error: required('is required: { "version": "x.y.z" }') }
);

const ImportSchema = z.strictObject({
  from: z.string().regex(NAME),
  id: z.string().regex(NAME),
  widgets: z.array(z.string().regex(NAME)),
});

export const CloudInstallationSchema = z.strictObject({
  host: z.string().max(63).regex(NAME),
  core: z
    .string()
    .regex(/^https:\/\/[a-z0-9.-]+$/)
    .optional(),
  program: ProgramSchema,
  shell: ShellSchema.optional(),
  extensions: z.array(RowSchema),
  imports: z.array(ImportSchema).optional(),
});

export type CloudInstallation = z.infer<typeof CloudInstallationSchema>;
export type CloudRow = CloudInstallation['extensions'][number];
// The keys the discovery and the runs read.
export type CloudRows = Pick<CloudInstallation, 'host' | 'extensions'>;
