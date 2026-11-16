import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The extension's own copy first (its devDependencies), else the one beside the kit (the cli's).
export const resolveFrom = (dir: string, name: string): string | undefined => {
  for (const base of [join(dir, 'package.json'), import.meta.url]) {
    try {
      return createRequire(base).resolve(name);
    } catch {
      // not there: the next base
    }
  }
  return undefined;
};

const needed = (dir: string, name: string): string => {
  const file = resolveFrom(dir, name);
  if (!file) throw new Error(`the app part needs ${name}: npm install --save-dev ${name}`);
  return file;
};

// A CommonJS module comes back as its default export.
export const loadFrom = async <T>(dir: string, name: string): Promise<T> => {
  const mod = (await import(pathToFileURL(needed(dir, name)).href)) as { default?: T } & T;
  return mod.default ?? mod;
};

export const packageDir = (dir: string, name: string): string =>
  dirname(needed(dir, `${name}/package.json`));
