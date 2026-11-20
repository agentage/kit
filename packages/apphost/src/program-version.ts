import { readFileSync } from 'node:fs';

// This program's own version: its package.json, one folder above src/ and dist/.
const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
export const PROGRAM_VERSION = (JSON.parse(manifest) as { version: string }).version;
