// Build check: each workspace package is a link (never npm), one kit copy anywhere in the tree, the bin,
// and the shell page when apphost depends on the shell package.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const list = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

// Every package folder under a node_modules, at any depth, scoped ones too.
const walk = (dir, found) => {
  for (const name of list(dir).filter((n) => !n.startsWith('.'))) {
    const names = name.startsWith('@') ? list(join(dir, name)).map((n) => join(name, n)) : [name];
    for (const pkg of names) {
      const path = join(dir, pkg);
      found.push(path);
      if (!lstatSync(path).isSymbolicLink()) walk(join(path, 'node_modules'), found);
    }
  }
  return found;
};

export const installProblems = (root) => {
  const packages = join(root, 'packages');
  const trees = [
    join(root, 'node_modules'),
    ...list(packages).map((d) => join(packages, d, 'node_modules')),
  ];
  const all = trees.flatMap((t) => walk(t, []));
  const hidden = join(root, 'node_modules/.package-lock.json');
  const locked = existsSync(hidden)
    ? Object.keys(json(hidden).packages).map((p) => join(root, p))
    : [];
  const workspace = new Set(
    list(packages).map((d) => json(join(packages, d, 'package.json')).name)
  );
  const ours = all.filter((p) => p.includes('/node_modules/@agentage/'));
  const isLink = (p) => lstatSync(p).isSymbolicLink() && realpathSync(p).startsWith(packages);
  const fromNpm = ours.filter(
    (p) => workspace.has(`@agentage/${p.split('/').pop()}`) && !isLink(p)
  );
  const kitPaths = [...all, ...locked].filter((p) =>
    p.endsWith('node_modules/@agentage/extension')
  );
  const kits = new Set(kitPaths.filter(existsSync).map((p) => realpathSync(p)));
  const SHELL = '@agentage/shell-dashboard';
  const needsShell = SHELL in (json(join(packages, 'apphost/package.json')).dependencies ?? {});
  const page = join(root, 'node_modules', SHELL, 'dist/index.html');
  return [
    ...fromNpm.map((p) => `${p}: not a workspace link`),
    ...(kits.size === 1
      ? []
      : [`${kits.size} copies of @agentage/extension, not 1: ${[...kits].join(' ')}`]),
    ...(!needsShell || existsSync(page) ? [] : ['no shell page (dist/index.html)']),
    ...(existsSync(join(root, 'node_modules/.bin/agentage-apphost-cloud'))
      ? []
      : ['no agentage-apphost-cloud bin']),
  ];
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = installProblems(process.argv[2]);
  for (const p of problems) console.error(`FAIL ${p}`);
  if (problems.length) process.exit(1);
  console.log('PASS one kit, workspace links, bin');
}
