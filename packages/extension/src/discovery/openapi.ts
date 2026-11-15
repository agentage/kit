import { join } from 'node:path';
import { z } from 'zod';
import { readJsonIfExists } from '../manifest/read-manifest.js';

export const OPENAPI_FILE = 'openapi.json';
// The api part's URL prefix: the extension id, no version (D3 of S1.1.1).
export const apiPrefix = (id: string): string => `/api/${id}`;
export const openapiPath = (id: string): string => `${apiPrefix(id)}/openapi.json`;

const OpenapiSchema = z.looseObject({
  openapi: z.string().regex(/^3\.1\.[0-9]+$/, { message: 'OpenAPI 3.1' }),
  paths: z.record(z.string(), z.unknown()),
});

// The api's contract, committed beside package.json (the repo diffs it against its Zod schemas).
export const readOpenapi = async (dir: string): Promise<Record<string, unknown> | null> => {
  const value = await readJsonIfExists(join(dir, OPENAPI_FILE));
  if (value === undefined) return null;
  const result = OpenapiSchema.safeParse(value);
  if (!result.success) throw new Error(`${OPENAPI_FILE} is not an OpenAPI 3.1 document`);
  return result.data;
};
