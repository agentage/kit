import { recordOf, validateRecord, type BuildInfo } from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type ContainerParts } from './container-parts.js';
import { stageContainer } from './container-stage.js';
import { buildStaged, pushByDigest, type Docker } from './docker.js';
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

interface ContainerJob {
  dir: string;
  pkg: ExtensionPackage;
  info: BuildInfo;
  registry: string;
  parts: ContainerParts;
  push?: boolean;
  tmpRoot?: string;
}

// The one-image record: the image by digest in place of one image per part.
const containerRecord = async (job: ContainerJob, image: string): Promise<ExtensionRecord> =>
  validateRecord({
    ...recordOf(job.pkg, job.info, {}, await recordExtras(job.dir, job.pkg)),
    image,
  });

// --container: one image; pushed, also its record.
export const buildContainer = async (job: ContainerJob, docker: Docker) => {
  const tag = `${job.registry}/${job.pkg.agentage.id}:${job.pkg.version}`;
  const context = await stageContainer(job.dir, job.pkg, job.tmpRoot);
  const buildArgs = { COMMIT_SHA: job.info.commit, BUILD_TIME: job.info.buildTime };
  const labels = labelsOf(job.pkg, undefined, job.info);
  await buildStaged(docker, { context, tag, buildArgs, labels });
  const container: BuiltContainer = { tag, ...job.parts };
  if (!job.push) return { container };
  const pushed = { ...container, ...(await pushByDigest(docker, tag)) };
  return { container: pushed, record: await containerRecord(job, pushed.image) };
};
