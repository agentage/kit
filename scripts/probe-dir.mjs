import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// examples keeps probe in extensions/probe since its folder layout; an older ref has it at the root.
export const probeDir = (checkout) => {
  const nested = join(checkout, 'extensions', 'probe');
  return existsSync(join(nested, 'package.json')) ? nested : checkout;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(probeDir(process.argv[2]));
