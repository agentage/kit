import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { normalizeParts } from '../manifest/parts.js';

// What the kit host (host/host-extension.ts) serves today; the other parts come later.
export const CONTAINER_RUNS = ['api'] as const;

export interface ContainerParts {
  runs: string[];
  skipped: string[];
}

// The parts the one image runs and those it carries but does not run yet.
export const containerParts = (pkg: ExtensionPackage): ContainerParts => {
  const kinds = Object.keys(normalizeParts(pkg.agentage.parts).code);
  const runs: readonly string[] = CONTAINER_RUNS;
  return {
    runs: kinds.filter((kind) => runs.includes(kind)),
    skipped: kinds.filter((kind) => !runs.includes(kind)),
  };
};

export const NO_API =
  'build --container needs an api part: the one image runs only the api part today';

export const runnableParts = (pkg: ExtensionPackage): ContainerParts => {
  const parts = containerParts(pkg);
  if (parts.runs.length === 0) throw new Error(NO_API);
  return parts;
};
