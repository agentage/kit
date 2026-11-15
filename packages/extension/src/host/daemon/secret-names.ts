import { fail } from '../../envelope/envelope.js';
import { readManifest } from '../../manifest/read-manifest.js';

const declared = (secrets: readonly (string | { name: string })[] = []) =>
  secrets.map((s) => (typeof s === 'string' ? s : s.name));

// Only a secret the package declares: the name becomes a file name in the child's folder.
export const checkSecrets = async (dir: string | undefined, names: string[], id: string) => {
  if (!names.length) return;
  if (!dir) throw fail('VALIDATION_ERROR', `${id} has no package yet: install it first`);
  const known = declared((await readManifest(dir)).agentage.secrets);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length)
    throw fail('VALIDATION_ERROR', `${id} declares no secret ${unknown.join(', ')}`);
};
