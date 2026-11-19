import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// The one shell package the program carries and serves on both kinds (J.4.5 row 1).
export const SHELL_PACKAGE = '@agentage/shell-dashboard';

// Its folder (package.json and dist/), as the program resolves it; undefined when not installed.
export const shellPackageDir = (from: string = import.meta.url): string | undefined => {
  try {
    return dirname(createRequire(from).resolve(`${SHELL_PACKAGE}/package.json`));
  } catch {
    return undefined;
  }
};
