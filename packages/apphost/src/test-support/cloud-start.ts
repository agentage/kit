import { writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { json, tempDir, tempPackage } from '../../../extension/src/test-support/packages.js';
import { type CloudHost, type CloudHostOptions, startCloudHost } from '../cloud-host.js';
import { PROGRAM_VERSION } from '../program-version.js';
import { SHELL_PACKAGE } from '../shell-package.js';
import { OWN, OWN_HOST, quietLog } from './cloud-upstream.js';

export * from './cloud-upstream.js';

export const CORE = 'https://core.next.agentage.io';

export interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

// node:http, not fetch: the tests set Host and send targets fetch would rewrite.
export const callAt = (
  port: number,
  path: string,
  o: { method?: string; headers?: Record<string, string> } = {}
) =>
  new Promise<Answer>((resolve, reject) => {
    const headers = { host: OWN_HOST, ...o.headers };
    const req = request(
      { host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject).end();
  });

export interface Rows {
  extensions: { id: string; expose?: Record<string, string> }[];
  upstreams: { id: string; address: string }[];
  shell?: { package: string };
}

// The two mounted files in a temp folder, and the env of a cloud host on port 0.
export const cloudEnv = async (rows: Rows, extra: Record<string, string> = {}) => {
  const dir = await tempDir('agentage-cloud-');
  const extensions = rows.extensions.map((e) => ({ version: '1.0.0', ...e }));
  const installationFile = join(dir, 'installation.json');
  const upstreamsFile = join(dir, 'upstreams.json');
  const shell = rows.shell && { shell: rows.shell };
  const program = { version: PROGRAM_VERSION };
  await writeFile(installationFile, json({ host: 'site', program, ...shell, extensions }));
  const listed = rows.upstreams.map((u) => ({ ...u, service: u.id }));
  await writeFile(upstreamsFile, json(listed));
  return {
    AGENTAGE_URL: OWN,
    AGENTAGE_CORE_URL: CORE,
    PORT: '0',
    AGENTAGE_INSTALLATION_FILE: installationFile,
    AGENTAGE_UPSTREAMS_FILE: upstreamsFile,
    ...extra,
  };
};

export interface Started extends CloudHost {
  call: (
    path: string,
    o?: { method?: string; headers?: Record<string, string> }
  ) => Promise<Answer>;
}

// A cloud host on port 0 that read every document once; options as the cloud entry takes them.
export const startCloud = async (
  env: NodeJS.ProcessEnv,
  options: CloudHostOptions = {}
): Promise<Started> => {
  const discovery = { readMs: 500, everyMs: 60_000, ...options.discovery };
  const host = await startCloudHost(env, { log: quietLog(), ...options, discovery });
  await host.refresh();
  return { ...host, call: (path, o) => callAt(host.port, path, o) };
};

// A host with a shell key: /shell/events and /shell/sign-out exist only there.
export const SHELL_KEY = { package: SHELL_PACKAGE };
export const SHELL_VERSION = '9.1.0';

export const startWithShell = async (
  rows: Rows,
  extra: Record<string, string> = {},
  options: CloudHostOptions = {}
): Promise<Started> => {
  const shellDir = await tempPackage({
    'package.json': json({ name: SHELL_PACKAGE, version: SHELL_VERSION }),
    'dist/index.html': '<!doctype html><title>shell</title>',
  });
  return startCloud(await cloudEnv({ ...rows, shell: SHELL_KEY }, extra), { shellDir, ...options });
};

// An open shell feed (GET /shell/events): every chunk it got so far.
export const openFeed = (port: number, headers: Record<string, string> = {}) =>
  new Promise<{ chunks: string[]; close(): void }>((resolve, reject) => {
    const chunks: string[] = [];
    const req = request(
      { host: '127.0.0.1', port, path: '/shell/events', headers: { host: OWN_HOST, ...headers } },
      (res) => {
        res.on('data', (c: Buffer) => chunks.push(c.toString()));
        resolve({ chunks, close: () => req.destroy() });
      }
    );
    req.on('error', reject).end();
  });
