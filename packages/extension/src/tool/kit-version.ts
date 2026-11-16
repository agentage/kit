import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const KIT_DIR = fileURLToPath(new URL('../..', import.meta.url));

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { version: string };

// The kit's own version: what a kit-shaped manifest's engines.agentage ranges over.
export const KIT_VERSION = readJson(join(KIT_DIR, 'package.json')).version;

// D8 (C10): the oldest kit minor the host runs, as the cli KIT_FLOOR; moves only with a breaking ctx change.
export const KIT_FLOOR = '0.12';

// The older minor (from the floor up to below the kit) that range names, or undefined.
export const olderKitMinor = (range: string, kit: string = KIT_VERSION): string | undefined => {
  const [major, minor = 0] = kit.split('.').map(Number);
  const [floorMajor, floor = 0] = KIT_FLOOR.split('.').map(Number);
  if (major !== floorMajor) return undefined;
  const minors = Array.from(
    { length: Math.max(0, minor - floor) },
    (_, i) => `${major}.${floor + i}`
  );
  return minors.find((older) => semver.intersects(range, `~${older}.0`));
};

// The PGlite copy the kit resolves (node_modules up from the kit folder): an exact version, or none.
export const kitPgliteVersion = (from: string = KIT_DIR): string | undefined => {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', '@electric-sql', 'pglite', 'package.json');
    if (existsSync(file)) return readJson(file).version;
    if (dirname(dir) === dir) return undefined;
  }
};
