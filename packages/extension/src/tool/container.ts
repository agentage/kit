import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordOf, validateRecord, type BuildInfo } from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { runnableParts, type ContainerParts } from './container-parts.js';
import { stageContainer } from './container-stage.js';
import { type Docker } from './docker.js';
import { labelsOf } from './labels.js';
import { recordExtras } from './record-extras.js';

// Beside the release record, so a container push never replaces what `extension release` reads.
export const CONTAINER_RECORD_FILE = 'agentage-container.json';

// runs: the parts the image serves; skipped: parts it carries but does not run yet.
export interface BuiltContainer extends ContainerParts {
  tag: string;
  digest?: string;
  image?: string;
}

export interface ContainerJob {
  dir: string;
  pkg: ExtensionPackage;
  info: BuildInfo;
  registry: string;
  push?: boolean;
  tmpRoot?: string;
}

export const containerTag = (registry: string, pkg: ExtensionPackage): string =>
  `${registry}/${pkg.agentage.id}:${pkg.version}`;

// The one-image record: the image by digest in place of one image per part.
export const containerRecord = async (
  dir: string,
  pkg: ExtensionPackage,
  info: BuildInfo,
  image: string
): Promise<ExtensionRecord> =>
  validateRecord({ ...recordOf(pkg, info, {}, await recordExtras(dir, pkg)), image });

const pushed = async (built: BuiltContainer, docker: Docker): Promise<BuiltContainer> => {
  const digest = await docker.push(built.tag);
  return { ...built, digest, image: `${built.tag.slice(0, built.tag.lastIndexOf(':'))}@${digest}` };
};

export const buildOneImage = async (job: ContainerJob, docker: Docker): Promise<BuiltContainer> => {
  const tag = containerTag(job.registry, job.pkg);
  const parts = runnableParts(job.pkg);
  const context = await stageContainer(job.dir, job.pkg, job.tmpRoot);
  try {
    const buildArgs = { COMMIT_SHA: job.info.commit, BUILD_TIME: job.info.buildTime };
    const labels = labelsOf(job.pkg, undefined, job.info);
    await docker.build({ context, tag, buildArgs, labels });
  } finally {
    await rm(context, { recursive: true, force: true });
  }
  const built = { tag, ...parts };
  return job.push ? pushed(built, docker) : built;
};

// --container: one image; with --push also dist/agentage-container.json.
export const buildContainer = async (job: ContainerJob, docker: Docker) => {
  const container = await buildOneImage(job, docker);
  if (!container.image) return { container };
  const record = await containerRecord(job.dir, job.pkg, job.info, container.image);
  const recordFile = join(job.dir, 'dist', CONTAINER_RECORD_FILE);
  await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  return { container, recordFile };
};
