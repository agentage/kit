import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { recordOf, validateRecord, type BuildInfo } from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { imageParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { type Env } from '../runtime/build-info.js';
import { resolveBuildInfo } from './build-info.js';
import { assertConforms } from './check.js';
import { containerParts, type ContainerParts } from './container-parts.js';
import { buildContainer, CONTAINER_RECORD_FILE, type BuiltContainer } from './container.js';
import { buildStaged, createDocker, pushByDigest, type Docker } from './docker.js';
import { mustRun, runCommand, type Run } from './exec.js';
import { labelsOf } from './labels.js';
import { recordExtras } from './record-extras.js';
import { RECORD_FILE, stageContext } from './stage.js';
import { TIMEOUTS } from './timeouts.js';

export const DEFAULT_REGISTRY = 'ghcr.io/agentage';

export interface BuildOptions {
  dir?: string;
  push?: boolean;
  registry?: string;
  // One image (`ghcr.io/agentage/{id}:{version}`) that runs the api part, in place of one per part.
  container?: boolean;
  env?: Env;
}

export interface BuildDeps {
  run: Run;
  docker?: Docker;
  tmpRoot?: string;
}

export interface BuiltImage {
  part: ImagePartKind;
  tag: string;
  digest?: string;
  image?: string;
}

export interface BuildResult {
  id: string;
  version: string;
  commit: string;
  buildTime: string;
  images: BuiltImage[];
  container?: BuiltContainer;
  recordFile?: string;
  warnings?: string[];
}

interface PartJob {
  dir: string;
  pkg: ExtensionPackage;
  part: ImagePartKind;
  info: BuildInfo;
  tag: string;
}

export const imageTag = (registry: string, pkg: ExtensionPackage, part: ImagePartKind): string =>
  `${registry}/${pkg.agentage.id}-${part}:${pkg.version}`;

const compile = async (dir: string, pkg: ExtensionPackage, run: Run): Promise<void> => {
  const scripts = (pkg as { scripts?: Record<string, unknown> }).scripts;
  if (typeof scripts?.['build'] === 'string')
    await mustRun(run, 'npm', ['run', 'build'], { cwd: dir, timeoutMs: TIMEOUTS.compile });
};

const buildImage = async (job: PartJob, docker: Docker, tmpRoot?: string): Promise<void> => {
  const context = await stageContext(job.dir, job.pkg, job.part, tmpRoot);
  const { commit, buildTime } = job.info;
  const buildArgs = { COMMIT_SHA: commit, BUILD_TIME: buildTime, IMAGE: job.tag };
  const labels = labelsOf(job.pkg, job.part, job.info);
  await buildStaged(docker, { context, tag: job.tag, buildArgs, labels });
};

const pushImage = async (job: PartJob, docker: Docker): Promise<BuiltImage> => ({
  part: job.part,
  tag: job.tag,
  ...(await pushByDigest(docker, job.tag)),
});

// The record from the code and the images by digest; `up` writes the same shape from local digests.
export const recordFor = async (
  dir: string,
  pkg: ExtensionPackage,
  info: BuildInfo,
  images: BuiltImage[]
): Promise<ExtensionRecord> => {
  const byPart = Object.fromEntries(images.map((built) => [built.part, built.image]));
  return validateRecord(recordOf(pkg, info, byPart, await recordExtras(dir, pkg)));
};

const writeRecord = async (
  dir: string,
  record: ExtensionRecord,
  file = join(dir, 'dist', RECORD_FILE)
) => {
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
};

type Base = Omit<PartJob, 'part' | 'tag'>;

const targetOf = (options: BuildOptions, deps: BuildDeps) => ({
  docker: deps.docker ?? createDocker(deps.run),
  registry: options.registry ?? DEFAULT_REGISTRY,
});

const buildParts = async (base: Base, options: BuildOptions, deps: BuildDeps) => {
  const { docker, registry } = targetOf(options, deps);
  const images: BuiltImage[] = [];
  for (const part of imageParts(base.pkg)) {
    const job = { ...base, part, tag: imageTag(registry, base.pkg, part) };
    await buildImage(job, docker, deps.tmpRoot);
    images.push(options.push ? await pushImage(job, docker) : { part, tag: job.tag });
  }
  return images;
};

// --container: one image; with --push also dist/agentage-container.json.
const containerOf = async (
  base: Base,
  parts: ContainerParts,
  opts: BuildOptions,
  deps: BuildDeps
) => {
  const { docker, registry } = targetOf(opts, deps);
  const job = { ...base, parts, registry, push: opts.push, tmpRoot: deps.tmpRoot };
  const { container, record } = await buildContainer(job, docker);
  if (!record) return { images: [], container };
  const file = join(base.dir, 'dist', CONTAINER_RECORD_FILE);
  return { images: [], container, recordFile: await writeRecord(base.dir, record, file) };
};

const partImages = async (base: Base, options: BuildOptions, deps: BuildDeps) => {
  const images = await buildParts(base, options, deps);
  if (!options.push) return { images };
  const record = await recordFor(base.dir, base.pkg, base.info, images);
  return { images, recordFile: await writeRecord(base.dir, record) };
};

// Validate, compile, check, one image per part (or the one image); --push pushes, writes the record.
export const build = async (
  options: BuildOptions = {},
  deps: BuildDeps = { run: runCommand }
): Promise<BuildResult> => {
  const dir = resolve(options.dir ?? '.');
  const pkg = await readManifest(dir);
  const parts = options.container ? containerParts(pkg) : undefined;
  const info = await resolveBuildInfo(dir, options.env ?? process.env, deps.run);
  await compile(dir, pkg, deps.run);
  const warnings = await assertConforms(dir, { run: deps.run });
  const base = { dir, pkg, info };
  const built = parts
    ? await containerOf(base, parts, options, deps)
    : await partImages(base, options, deps);
  const warned = warnings.length > 0 ? { warnings } : {};
  return { id: pkg.agentage.id, version: pkg.version, ...info, ...built, ...warned };
};
