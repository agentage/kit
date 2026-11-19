import { type CloudDiscovery } from './cloud-discovery.js';
import { type CloudInstallation } from './cloud-files.js';
import { readShell, type Shell } from './shell-routes.js';

// The shell of a host with a `shell` key: the package the program carries, the one the key names.
// A host with no key has no shell (J.4.5 row 7); a key the program cannot serve refuses the start.
export const cloudShell = async (
  installation: CloudInstallation,
  dir: string | undefined
): Promise<Shell | undefined> => {
  if (!installation.shell) return undefined;
  const { package: name, version } = installation.shell;
  if (!dir) throw new Error(`shell: installation.json names ${name}, the program carries none`);
  const shell = await readShell(dir);
  if (shell.package !== name || shell.version !== version)
    throw new Error(
      `shell: installation.json names ${name}@${version}, ` +
        `the program carries ${shell.package}@${shell.version}`
    );
  return shell;
};

// The page answers 200 at /{id} only for an entry whose app part is public.
export const publicApp =
  (discovery: Pick<CloudDiscovery, 'current'>) =>
  (id: string): boolean =>
    discovery.current().document.extensions.some((e) => e.id === id && e.expose.app === 'public');
