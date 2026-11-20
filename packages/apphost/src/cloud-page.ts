import { type CloudDiscovery } from './cloud-discovery.js';
import { type CloudInstallation } from './cloud-installation.js';
import { type PageRule, readShell, type Shell } from './shell-routes.js';

export interface Served {
  shell?: Shell;
  refusals: string[];
}

// The site catch-all would take /, /{id} and /shell/*: no host needs both, so the start is refused.
const pagesBeside = (installation: CloudInstallation, name: string): string[] => {
  const site = installation.extensions.find((e) => e.expose?.pages === 'public');
  return site
    ? [
        `shell: installation.json names ${name} and a public pages part (${site.id}); ` +
          'a host has one or the other',
      ]
    : [];
};

// The shell of a host with a `shell` key: the package the program carries, its version as carried.
// A host with no key has no shell (J.4.5 row 7); a key the program cannot serve is refused.
export const servedShell = async (
  installation: CloudInstallation,
  dir: string | undefined
): Promise<Served> => {
  if (!installation.shell) return { refusals: [] };
  const name = installation.shell.package;
  const refusals = pagesBeside(installation, name);
  if (!dir)
    return {
      refusals: [...refusals, `shell: installation.json names ${name}, the program carries none`],
    };
  const shell = await readShell(dir);
  if (shell.package !== name)
    refusals.push(`shell: installation.json names ${name}, the program carries ${shell.package}`);
  return refusals.length ? { refusals } : { shell, refusals };
};

// A page only for an Accept that names text/html (the stub router; e2e reads JSON for */*), and
// 200 at /{id} only for an entry whose app part is public.
export const cloudPageRule = (discovery: Pick<CloudDiscovery, 'current'>): PageRule => ({
  wantsPage: (req) => /text\/html/.test(req.headers.accept ?? ''),
  isApp: (id) =>
    discovery.current().document.extensions.some((e) => e.id === id && e.expose.app === 'public'),
});
