import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hostParts, imageParts } from '../manifest/parts.js';

export interface ContainerParts {
  runs: string[];
  skipped: string[];
}

export const NO_API =
  'build --container needs an api, mcp or worker part: the one image runs the server parts';

// The kit host (host/host-extension.ts) runs every server part; pages and ui come in phase 2.
export const containerParts = (pkg: ExtensionPackage): ContainerParts => {
  const runs: string[] = hostParts(pkg);
  if (runs.length === 0) throw new Error(NO_API);
  return { runs, skipped: imageParts(pkg).filter((kind) => !runs.includes(kind)) };
};
