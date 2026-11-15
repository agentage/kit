import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { imageParts } from '../manifest/parts.js';

export interface ContainerParts {
  runs: string[];
  skipped: string[];
}

export const NO_API =
  'build --container needs an api part: the one image runs only the api part today';

// The kit host (host/host-extension.ts) serves the api part; other image parts come later.
export const containerParts = (pkg: ExtensionPackage): ContainerParts => {
  const parts = imageParts(pkg);
  if (!parts.includes('api')) throw new Error(NO_API);
  return { runs: ['api'], skipped: parts.filter((kind) => kind !== 'api') };
};
