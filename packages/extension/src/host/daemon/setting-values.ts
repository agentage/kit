import { fits, type Setting } from '../../context/settings.js';
import { fail } from '../../envelope/envelope.js';
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
    throw refused(key, `${JSON.stringify(given)} is not a ${setting.type}`);
  return value;
};

// A client sends text (`configure probe limit=5`): a string becomes the type the manifest declares.
export const coerceSettings = async (
  dir: string | undefined,
  given: Record<string, unknown>,
  id: string
): Promise<Record<string, unknown>> => {
  if (!Object.keys(given).length) return given;
  if (!dir) throw fail('VALIDATION_ERROR', `${id} has no package yet: install it first`);
  const declared = (await readManifest(dir)).agentage.settings ?? {};
  return Object.fromEntries(
    Object.entries(given).map(([key, value]) => [key, valueOf(key, declared[key], value)])
  );
};
