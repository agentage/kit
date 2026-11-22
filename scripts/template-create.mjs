import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Mirrors `agentage extension create` (cli src/commands/extension/create.ts): the cli reads a GitHub repo only.
const PARTS = ['pages', 'ui', 'api', 'mcp', 'worker', 'store', 'cli', 'app'];
const WORD = /(?<![A-Za-z0-9])template(?![A-Za-z0-9])/g;
const PRUNE = {
  cli: { keys: [['agentage', 'commands']] },
  mcp: { keys: [['agentage', 'settings', 'mcp.listing']], paths: ['template.mcpc.json'] },
  api: { paths: ['openapi.json'] },
  store: { paths: ['migrations', 'seeds'] },
  app: { keys: [['agentage', 'app']], paths: ['src/app-part.test.tsx', 'src/app-lint.test.ts'] },
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const drop = (dir, kept) => {
  const pkg = readJson(join(dir, 'package.json'));
  for (const part of PARTS.filter((p) => !kept.includes(p))) {
    delete pkg.agentage?.parts?.[part];
    for (const sub of [join('src', part), ...(PRUNE[part]?.paths ?? [])])
      rmSync(join(dir, sub), { recursive: true, force: true });
    for (const path of PRUNE[part]?.keys ?? []) {
      const parent = path.slice(0, -1).reduce((at, key) => at?.[key], pkg);
      if (parent) delete parent[path.at(-1)];
    }
  }
  save(join(dir, 'package.json'), pkg);
};

const rewrite = (dir, id) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewrite(path, id);
    if (entry.isFile() && entry.name !== 'package-lock.json') {
      const text = readFileSync(path, 'utf8');
      if (text.replace(WORD, id) !== text) writeFileSync(path, text.replace(WORD, id));
    }
    const name = entry.name.replace(WORD, id);
    if (name !== entry.name) renameSync(path, join(dir, name));
  }
};

const renameLock = (dir, id) => {
  const file = join(dir, 'package-lock.json');
  const lock = readJson(file);
  for (const at of [lock, lock.packages?.['']]) if (at) at.name = `@agentage/extension-${id}`;
  save(file, lock);
};

export const createFromTemplate = (from, to, id, parts = PARTS) => {
  if (existsSync(to)) throw new Error(`${to} exists`);
  cpSync(from, to, { recursive: true, filter: (src) => !/node_modules|\.kit/.test(src) });
  drop(to, parts);
  rewrite(to, id);
  renameLock(to, id);
};

const [from, to, id, ...parts] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`)
  createFromTemplate(from, to, id, parts.length ? parts : PARTS);
