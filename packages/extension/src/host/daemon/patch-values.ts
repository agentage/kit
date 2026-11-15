import { fits, type Setting } from '../../context/settings.js';
import { fail } from '../../envelope/envelope.js';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { readManifest } from '../../manifest/read-manifest.js';

const PARSE: Record<string, (text: string) => unknown> = {
  number: (t) => (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t) ? Number(t) : t),
  integer: (t) => (/^-?\d+$/.test(t) ? Number(t) : t),
  boolean: (t) => (t === 'true' ? true : t === 'false' ? false : t),
};

const refused = (key: string, message: string) =>
  fail('VALIDATION_ERROR', `setting ${key}: ${message}`, { code: 'INVALID_SETTING' });

const valueOf = (key: string, setting: Setting | undefined, given: unknown) => {
  if (!setting) throw refused(key, 'not declared in the manifest');
  const value = typeof given === 'string' ? (PARSE[setting.type]?.(given) ?? given) : given;
  if (!fits(setting, value))
    throw refused(key, `${JSON.stringify(given)} is not a valid ${setting.type}`);
  return value;
};

// Only a secret the package declares: the name becomes a file name in the child's folder.
const checkSecrets = (pkg: ExtensionPackage, names: string[], id: string): void => {
  const known = (pkg.agentage.secrets ?? []).map((s) => (typeof s === 'string' ? s : s.name));
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length)
    throw fail('VALIDATION_ERROR', `${id} declares no secret ${unknown.join(', ')}`);
};

interface GivenValues {
  settings?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

// The secret names checked, and each setting a client sent as text (`limit=5`) in its declared type.
export const checkedSettings = async (dir: string | undefined, given: GivenValues, id: string) => {
  const settings = given.settings ?? {};
  const names = Object.keys(given.secrets ?? {});
  if (!names.length && !Object.keys(settings).length) return settings;
  if (!dir) throw fail('VALIDATION_ERROR', `${id} has no package yet: install it first`);
  const pkg = await readManifest(dir);
  checkSecrets(pkg, names, id);
  const declared = pkg.agentage.settings ?? {};
  const typed = Object.entries(settings).map(([key, v]) => [key, valueOf(key, declared[key], v)]);
  return Object.fromEntries(typed) as Record<string, unknown>;
};
