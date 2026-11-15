import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = fileURLToPath(new URL('../..', import.meta.url));

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { version: string };

// The kit's own version: what a kit-shaped manifest's engines.agentage ranges over.
export const KIT_VERSION = readJson(join(KIT_DIR, 'package.json')).version;

// The PGlite copy the kit resolves (node_modules up from the kit folder): an exact version, or none.
export const kitPgliteVersion = (from: string = KIT_DIR): string | undefined => {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', '@electric-sql', 'pglite', 'package.json');
    if (existsSync(file)) return readJson(file).version;
    if (dirname(dir) === dir) return undefined;
  }
};
