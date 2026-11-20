// The apphost-image job of release.yml: the record content, the facts and the decision to build,
// record, skip or refuse. Commands go through `run`, so the tests need no registry.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const IMAGE = 'ghcr.io/agentage/platform/apphost';
export const ASSET = 'agentage-apphost.json';
const SHELL = '@agentage/shell-dashboard';
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};

/** The asset agentage-apphost.json of release @agentage/apphost@<version>. */
export const imageRecord = ({ apphost, kit, commit, digest }) => {
  const shell = apphost.dependencies?.[SHELL];
  need(SEMVER.test(apphost.version ?? ''), `apphost version ${apphost.version} is not semver`);
  need(SEMVER.test(shell ?? ''), `${SHELL} ${shell} is not an exact version in apphost`);
  need(SEMVER.test(kit.version ?? ''), `kit version ${kit.version} is not semver`);
  need(COMMIT.test(commit ?? ''), `commit ${commit} is not 40 hex`);
  need(DIGEST.test(digest ?? ''), `digest ${digest} is not sha256:<64 hex>`);
  return {
    package: apphost.name,
    version: apphost.version,
    commit,
    image: `${IMAGE}:${apphost.version}@${digest}`,
    shell: { package: SHELL, version: shell },
    kit: kit.version,
  };
};

/** f: hasAsset, releaseCommit ('' = no tag), commit, versionDigest and commitDigest ('' = absent). */
export const imageDecision = (f) => {
  if (f.hasAsset) return { action: 'skip', reason: `${ASSET} is on the release` };
  if (f.releaseCommit && f.releaseCommit !== f.commit)
    return { action: 'skip', reason: `released at ${f.releaseCommit}, not this commit: no image` };
  const digest = f.versionDigest;
  if (!digest) return { action: 'build', reason: 'no image tag for this version' };
  if (digest === f.commitDigest)
    return { action: 'record', digest, reason: 'the image of this commit is pushed' };
  return { action: 'refuse', reason: `tag has ${digest}, not the image of ${f.commit}` };
};

const NEVER = /(?!)/;

// A probe answers a value, '' for a clean "absent", or throws: an outage is never "absent".
const probe = (run, cmd, args, absent, pick) => {
  const { status, stdout = '', stderr = '' } = run(cmd, args);
  if (status === 0) return pick(stdout.trim());
  if (absent.test(`${stdout}${stderr}`)) return '';
  throw new Error(`${cmd} ${args.join(' ')} failed (${status}): ${`${stderr}`.trim()}`);
};

export const registryDigest = (run, ref) =>
  probe(
    run,
    'docker',
    ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'],
    /: not found$|manifest unknown|name unknown/im,
    (out) => JSON.parse(out).digest
  );

export const releaseAssets = (run, tag) =>
  probe(run, 'gh', ['release', 'view', tag, '--json', 'assets'], /release not found/i, (out) =>
    JSON.parse(out).assets.map((a) => a.name)
  );

// The commit a git tag names on origin (peeled for an annotated tag), '' when there is no tag.
export const tagCommit = (run, tag) => {
  const out = probe(
    run,
    'git',
    ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    NEVER,
    (o) => o
  );
  const lines = out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
  return (lines.find(([, r]) => r.endsWith('^{}')) ?? lines[0])?.[0] ?? '';
};

export const facts = (run, { version, commit }) => {
  const tag = `@agentage/apphost@${version}`;
  const assets = releaseAssets(run, tag);
  return {
    hasAsset: Array.isArray(assets) && assets.includes(ASSET),
    releaseCommit: tagCommit(run, tag),
    commit,
    // Read only when the decision needs them: a skip makes no registry call.
    get versionDigest() {
      return registryDigest(run, `${IMAGE}:${version}`);
    },
    get commitDigest() {
      return registryDigest(run, `${IMAGE}:${commit}`);
    },
  };
};

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifests = (root) => ({
  apphost: read(`${root}/packages/apphost/package.json`),
  kit: read(`${root}/packages/extension/package.json`),
});

/** decide: GITHUB_OUTPUT lines (version, action, digest, reason); record DIGEST: the asset JSON. */
export const main = ([command, digest], { root, commit, run }) => {
  const m = manifests(root);
  if (command === 'record')
    return `${JSON.stringify(imageRecord({ ...m, commit, digest }), null, 2)}\n`;
  need(command === 'decide', 'usage: image-release.mjs decide | record DIGEST');
  const d = imageDecision(facts(run, { version: m.apphost.version, commit }));
  return `version=${m.apphost.version}\naction=${d.action}\ndigest=${d.digest ?? ''}\nreason=${d.reason}\n`;
};

const spawn = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = main(process.argv.slice(2), {
    root: '.',
    commit: process.env.GITHUB_SHA,
    run: spawn,
  });
  process.stdout.write(out);
  if (out.includes('\naction=refuse\n')) {
    console.error(`::error::${out.split('reason=')[1].trim()}`);
    process.exit(1);
  }
}
