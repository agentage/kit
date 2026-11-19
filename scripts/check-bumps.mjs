import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const base = process.argv[2] ?? 'origin/master';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const manifestAt = (ref, dir) => {
  try {
    return JSON.parse(git('show', `${ref}:${dir}/package.json`));
  } catch {
    return null;
  }
};
const versionAt = (ref, dir) => manifestAt(ref, dir)?.version ?? null;
// package.json without its version: a moved dependency or peer range is a change in the package.
const restAt = (ref, dir) => JSON.stringify({ ...manifestAt(ref, dir), version: undefined });

const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const failures = [];
for (const name of readdirSync('packages')) {
  const dir = `packages/${name}`;
  const was = versionAt(base, dir);
  if (was === null || was === versionAt('HEAD', dir)) continue;
  const others = changed.filter((f) => f.startsWith(`${dir}/`) && f !== `${dir}/package.json`);
  if (others.length === 0 && restAt(base, dir) === restAt('HEAD', dir)) failures.push(dir);
}
for (const dir of failures)
  console.error(`::error::${dir} changes version with no other change in it`);
process.exit(failures.length === 0 ? 0 : 1);
