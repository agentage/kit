import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fail } from '@agentage/extension/internal';

// A path is checked as given and modules load from the real path: a symlinked folder needs both.
export const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

// True when path is folder or inside it.
const within = (path: string, folder: string): boolean => {
  const rel = relative(folder, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

// The tree folders the cli installs into: the shared 0.51 tree, or one tree per id@version.
const ownTree = (grant: string, configDir: string, id: string): boolean => {
  const [first, second, third] = relative(join(configDir, 'extensions'), grant).split(sep);
  if (first === 'trees') return !!second && !second.startsWith('.');
  const name = first === 'packages' && second === 'trees' ? third : undefined;
  return !!name && name.startsWith(`${id}@`) && name.length > id.length + 1;
};

// Inside the config dir only the extension's own tree holds no secret, row or other id's folder.
const exposes = (grant: string, configDir: string, id: string): boolean =>
  within(configDir, grant) || (within(grant, configDir) && !ownTree(grant, configDir, id));

const refused = (path: string, why: string) =>
  fail('VALIDATION_ERROR', `seal: the folder ${path} ${why}`);

// Node reads a * in a grant as a wildcard; a read grant on the config dir (or above it) shows daemon.json and secrets.json.
export const assertReach = (
  reads: string[],
  writes: string[],
  configDir: string,
  id: string
): void => {
  const star = [...reads, ...writes].find((path) => path.includes('*'));
  if (star) throw refused(star, 'has a * that Node reads as a wildcard');
  const configs = [configDir, real(configDir)];
  const open = reads.find((grant) =>
    [grant, real(grant)].some((path) => configs.some((config) => exposes(path, config, id)))
  );
  if (open) throw refused(open, 'would expose the agentage config folder');
};
