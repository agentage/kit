import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fail } from '../../envelope/envelope.js';

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

// The cli trees hold packages only; every other folder of the config dir holds a secret or a row.
const exposes = (grant: string, configDir: string): boolean =>
  within(configDir, grant) ||
  (within(grant, configDir) && !within(grant, join(configDir, 'extensions', 'trees')));

const refused = (path: string, why: string) =>
  fail('VALIDATION_ERROR', `seal: the folder ${path} ${why}`);

// Node reads a * in a grant as a wildcard; a read grant on the config dir (or above it) shows daemon.json and secrets.json.
export const assertReach = (reads: string[], writes: string[], configDir: string): void => {
  const star = [...reads, ...writes].find((path) => path.includes('*'));
  if (star) throw refused(star, 'has a * that Node reads as a wildcard');
  const configs = [configDir, real(configDir)];
  const open = reads.find((grant) => configs.some((config) => exposes(grant, config)));
  if (open) throw refused(open, 'would expose the agentage config folder');
};
