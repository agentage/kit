import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The shell the kit carries (dist/shell, written by the kit build); none when run from src.
export const kitShellDir = (base: string = import.meta.url): string | undefined => {
  const dir = fileURLToPath(new URL('../shell', base));
  return existsSync(join(dir, 'package.json')) ? dir : undefined;
};
