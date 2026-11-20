import { combineHost, type HostInstallation } from '@agentage/extension/internal';
import { type CloudInstallation, type CloudRows } from './cloud-installation.js';
import { servedShell } from './cloud-page.js';
import { checkInstallation } from './cloud-rules.js';
import { PROGRAM_VERSION } from './program-version.js';
import { type Shell } from './shell-routes.js';
import { type Upstream, UpstreamListSchema } from './upstream-runner.js';

export interface CloudFiles {
  installation: CloudInstallation;
  upstreams: Upstream[];
}

export interface HostCheck {
  // The text of each file; undefined when it is not there.
  installation: string | undefined;
  upstreams: string | undefined;
  // --check names the folder (host equals it); the start has a fixed mount.
  folder?: string;
  shellDir: string | undefined;
}

export interface Checked {
  files?: CloudFiles;
  shell?: Shell;
  refusals: string[];
}

// The rows the combine reads, with the shell the program serves (the version reported is served).
export const hostInstallationOf = (installation: CloudRows, shell?: Shell): HostInstallation => {
  const served = shell && { shell: { package: shell.package, version: shell.version } };
  return { host: installation.host, ...served, extensions: installation.extensions };
};

const jsonOf = (name: string, text: string | undefined) => {
  if (text === undefined) return { refusals: [`${name}: absent`] };
  try {
    return { value: JSON.parse(text) as unknown, refusals: [] };
  } catch (err) {
    return { refusals: [`${name}: ${(err as Error).message}`] };
  }
};

const upstreamsOf = (text: string | undefined) => {
  const json = jsonOf('upstreams.json', text);
  if (json.refusals.length) return { refusals: json.refusals };
  const parsed = UpstreamListSchema.safeParse(json.value);
  if (parsed.success) return { upstreams: parsed.data, refusals: [] };
  const lines = parsed.error.issues.map(
    (i) => `upstreams.json [${i.path.join('.')}]: ${i.message}`
  );
  return { refusals: lines };
};

const installationOf = (text: string | undefined, folder?: string) => {
  const json = jsonOf('installation.json', text);
  return json.refusals.length ? json : checkInstallation(json.value, folder);
};

const programRefusals = ({ program }: CloudInstallation, own = PROGRAM_VERSION) =>
  program.version === own
    ? []
    : [`installation.json program.version: ${program.version}, this program is ${own}`];

// One combine with no reads: what the start would refuse at its first combine.
const combineRefusals = (installation: CloudInstallation, shell?: Shell) => {
  try {
    combineHost({
      kind: 'cloud',
      installation: hostInstallationOf(installation, shell),
      answers: [],
    });
    return [];
  } catch (err) {
    const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [];
    const why = issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');
    return [`installation.json: the host document refuses it: ${why || (err as Error).message}`];
  }
};

// The checks of the start and of --check: every refusal, one line each; no I/O but the shell read.
export const checkHost = async (input: HostCheck): Promise<Checked> => {
  const checked = installationOf(input.installation, input.folder);
  const listed = upstreamsOf(input.upstreams);
  const refusals = [...checked.refusals, ...listed.refusals];
  const installation = 'installation' in checked ? checked.installation : undefined;
  if (!installation) return { refusals };
  const served = await servedShell(installation, input.shellDir);
  refusals.push(...programRefusals(installation), ...served.refusals);
  // The combine last: a file the rules refuse would give the same refusal twice.
  if (!refusals.length) refusals.push(...combineRefusals(installation, served.shell));
  if (refusals.length || !listed.upstreams) return { refusals };
  const files = { installation, upstreams: listed.upstreams };
  return { files, ...(served.shell && { shell: served.shell }), refusals };
};
