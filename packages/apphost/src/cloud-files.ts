import { readFile } from 'node:fs/promises';
import { checkHost, type CloudFiles } from './cloud-check.js';
import { PROGRAM_VERSION } from './program-version.js';
import { type Shell } from './shell-routes.js';

export { type CloudFiles } from './cloud-check.js';
export { type CloudInstallation } from './cloud-installation.js';

export interface StartFiles {
  files: CloudFiles;
  shell?: Shell;
}

const absent = (err: unknown) => (err as { code?: unknown }).code === 'ENOENT';

// A file that is not there is undefined; any other failure refuses the start with the file named.
export const textOf = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (absent(err)) return undefined;
    throw new Error(`${file}: ${(err as Error).message}`);
  }
};

// D61: a host with no installation.json names itself from AGENTAGE_URL and has no rows.
const unnamed = (own: string): StartFiles => {
  const host = new URL(own).hostname.split('.')[0] ?? '';
  const installation = { host, program: { version: PROGRAM_VERSION }, extensions: [] };
  return { files: { installation, upstreams: [] } };
};

// The start: the checks of --check (but the folder name); any refusal refuses the start.
export const readCloudFiles = async (
  installationFile: string,
  upstreamsFile: string,
  own: string,
  shellDir: string | undefined
): Promise<StartFiles> => {
  const installation = await textOf(installationFile);
  const upstreams = await textOf(upstreamsFile);
  if (installation === undefined) return unnamed(own);
  if (upstreams === undefined) throw new Error(`${upstreamsFile}: absent beside installation.json`);
  const checked = await checkHost({ installation, upstreams, shellDir });
  if (!checked.files) throw new Error(`${installationFile}: ${checked.refusals.join('; ')}`);
  return { files: checked.files, ...(checked.shell && { shell: checked.shell }) };
};
