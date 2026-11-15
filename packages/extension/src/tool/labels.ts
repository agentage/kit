import { type BuildInfo } from '../discovery/discovery.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';

const repositoryUrl = (pkg: ExtensionPackage): string | undefined => {
  const repo = (pkg as { repository?: unknown }).repository;
  const url = typeof repo === 'string' ? repo : (repo as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string') return undefined;
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
};

// OCI labels: revision is the full sha, created the build time; source links the GHCR package.
// No part: the one image, titled {id} with no io.agentage.part.
export const labelsOf = (
  pkg: ExtensionPackage,
  part: ImagePartKind | undefined,
  build: BuildInfo
): Record<string, string> => {
  const labels: Record<string, string> = {
    'org.opencontainers.image.revision': build.commit,
    'org.opencontainers.image.created': build.buildTime,
    'org.opencontainers.image.version': pkg.version,
    'org.opencontainers.image.title': part ? `${pkg.agentage.id}-${part}` : pkg.agentage.id,
    'io.agentage.extension': pkg.agentage.id,
  };
  if (part) labels['io.agentage.part'] = part;
  const source = repositoryUrl(pkg);
  if (source) labels['org.opencontainers.image.source'] = source;
  return labels;
};
