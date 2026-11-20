import { basename, join, resolve } from 'node:path';
import { checkHost } from './cloud-check.js';
import { textOf } from './cloud-files.js';
import { shellPackageDir } from './shell-package.js';

const say = (line: string) => void process.stdout.write(`${line}\n`);

// --check DIR: the start's checks on DIR/installation.json and DIR/upstreams.json; no env, no port.
export const runCheck = async (
  dir: string | undefined,
  write: (line: string) => unknown = say
): Promise<0 | 1> => {
  if (!dir) return (write('--check: name the folder of a host: --check DIR'), 1);
  const folder = resolve(dir);
  try {
    const installation = await textOf(join(folder, 'installation.json'));
    const upstreams = await textOf(join(folder, 'upstreams.json'));
    const input = { installation, upstreams, folder: basename(folder) };
    const { refusals } = await checkHost({ ...input, shellDir: shellPackageDir() });
    refusals.forEach((line) => write(line));
    return refusals.length ? 1 : 0;
  } catch (err) {
    return (write((err as Error).message), 1);
  }
};
