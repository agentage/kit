import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ExtensionIdSchema, type HostEntry } from '@agentage/extension/internal';
import { readUpstreams, type Upstream } from './upstream-runner.js';

// The rows combineHost reads; expose is checked by the host schema at the first combine.
const CloudInstallationSchema = z.looseObject({
  host: z.string().regex(/^[a-z][a-z0-9-]*$/),
  shell: z.strictObject({ package: z.string().min(1), version: z.string().min(1) }).optional(),
  extensions: z.array(
    z.looseObject({
      id: ExtensionIdSchema,
      version: z.string().min(1),
      enabled: z.boolean().optional(),
      expose: z.custom<HostEntry['expose']>((v) => typeof v === 'object' && v !== null).optional(),
    })
  ),
});
export type CloudInstallation = z.infer<typeof CloudInstallationSchema>;

export interface CloudFiles {
  installation: CloudInstallation;
  upstreams: Upstream[];
}

const absent = (err: unknown) => (err as { code?: unknown }).code === 'ENOENT';

// A file that is not there is undefined; any other failure refuses the start with the file named.
const optional = async <T>(file: string, read: (file: string) => Promise<T>) => {
  try {
    return await read(file);
  } catch (err) {
    if (absent(err)) return undefined;
    throw new Error(`${file}: ${(err as Error).message}`);
  }
};

const readInstallation = async (file: string) =>
  CloudInstallationSchema.parse(JSON.parse(await readFile(file, 'utf8')));

// D61: a host with installation.json routes its rows; with none it names itself from AGENTAGE_URL.
export const readCloudFiles = async (
  installationFile: string,
  upstreamsFile: string,
  own: string
): Promise<CloudFiles> => {
  const installation = await optional(installationFile, readInstallation);
  const upstreams = await optional(upstreamsFile, readUpstreams);
  if (installation && !upstreams)
    throw new Error(`${upstreamsFile}: absent beside installation.json`);
  const host = new URL(own).hostname.split('.')[0] ?? '';
  return { installation: installation ?? { host, extensions: [] }, upstreams: upstreams ?? [] };
};
