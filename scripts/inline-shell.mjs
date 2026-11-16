import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The kit carries the built dashboard shell (private workspace packages/shell-dashboard) at dist/shell.
const root = join(import.meta.dirname, '..');
const from = join(root, 'packages/shell-dashboard');
const to = join(root, 'packages/extension/dist/shell');
rmSync(to, { recursive: true, force: true });
cpSync(join(from, 'dist'), join(to, 'dist'), { recursive: true });
const { name, version } = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
writeFileSync(
  join(to, 'package.json'),
  `${JSON.stringify({ name, version, private: true }, null, 2)}\n`
);
console.log(`inline-shell: ${name}@${version} copied to dist/shell`);
