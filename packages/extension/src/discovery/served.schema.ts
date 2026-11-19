import { z } from 'zod';
import { AppMetaSchema } from '../manifest/manifest.schema.js';
import { IMAGE_PART_KINDS } from '../manifest/primitives.schema.js';

// What one container answers for: its part kinds, and app when it serves the bundle at /app/{id}/.
export const SERVES_KINDS = [...IMAGE_PART_KINDS, 'app'] as const;

export type ServesKind = (typeof SERVES_KINDS)[number];

const noRepeat = (kinds: readonly string[]) => new Set(kinds).size === kinds.length;

export const ServesSchema = z
  .array(z.enum(SERVES_KINDS))
  .min(1)
  .refine(noRepeat, { message: 'each part once' });

// The nav row of the app part: its meta and the content-hashed bundle files.
export const AppRowSchema = AppMetaSchema.extend({
  entry: z.string().regex(/^\/app\/[a-z][a-z0-9-]*\/app-[0-9a-f]+\.js$/),
  css: z.string().regex(/^\/app\/[a-z][a-z0-9-]*\/app-[0-9a-f]+\.css$/),
});

export type AppRowDoc = z.infer<typeof AppRowSchema>;

interface ServedRow {
  id: string;
  serves: readonly ServesKind[];
  app?: AppRowDoc;
}

// The app row comes with app in serves, and its files sit under /app/{id}/ of this id.
export const appRowFits = ({ id, serves, app }: ServedRow) => {
  if (!app) return !serves.includes('app');
  const at = `/app/${id}/`;
  return serves.includes('app') && app.entry.startsWith(at) && app.css.startsWith(at);
};

export const APP_ROW_RULE = {
  message: 'app is set exactly when serves lists app, with files under /app/{id}/',
  path: ['app'],
};
