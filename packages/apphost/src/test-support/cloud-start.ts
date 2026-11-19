import { writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { json, tempDir } from '../../../extension/src/test-support/packages.js';
import { type CloudHost, type CloudHostOptions, startCloudHost } from '../cloud-host.js';
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
  extensions: { id: string; expose?: Record<string, string>; enabled?: boolean }[];
  upstreams: { id: string; address: string }[];
  shell?: { package: string; version: string };
}

// The two mounted files in a temp folder, and the env of a cloud host on port 0.
export const cloudEnv = async (rows: Rows, extra: Record<string, string> = {}) => {
  const dir = await tempDir('agentage-cloud-');
  const extensions = rows.extensions.map((e) => ({ version: '1.0.0', ...e }));
  const installationFile = join(dir, 'installation.json');
  const upstreamsFile = join(dir, 'upstreams.json');
  const shell = rows.shell && { shell: rows.shell };
  await writeFile(installationFile, json({ host: 'site', ...shell, extensions }));
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

// An open shell feed (GET /shell/events): every chunk it got so far.
export const openFeed = (port: number) =>
  new Promise<{ chunks: string[]; close(): void }>((resolve, reject) => {
    const chunks: string[] = [];
    const req = request(
      { host: '127.0.0.1', port, path: '/shell/events', headers: { host: OWN_HOST } },
      (res) => {
        res.on('data', (c: Buffer) => chunks.push(c.toString()));
        resolve({ chunks, close: () => req.destroy() });
      }
    );
    req.on('error', reject).end();
  });
