import { readFileSync } from 'node:fs';

const kit = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
  peerDependencies: { '@electric-sql/pglite': string };
};

// The kit's own version: what a kit-shaped manifest's engines.agentage ranges over.
export const KIT_VERSION = kit.version;

// The PGlite the host loads when the package lock names none.
export const KIT_PGLITE_RANGE = kit.peerDependencies['@electric-sql/pglite'];
