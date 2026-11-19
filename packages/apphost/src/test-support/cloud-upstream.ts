import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { type AddressInfo } from 'node:net';
import { createLog, type Log } from '@agentage/extension/internal';

export const OWN = 'https://platform-host.next.agentage.io';
export const OWN_HOST = new URL(OWN).host;
const APP = (id: string) => ({
  title: id,
  entry: `/app/${id}/app-0123456789.js`,
  css: `/app/${id}/app-0123456789.css`,
});

export const docOf = (id: string, serves: string[] = ['api', 'mcp']) => ({
  id,
  version: '1.0.0',
  commit: 'a'.repeat(40),
  buildTime: '2026-11-19T00:00:00Z',
  host: OWN,
  parts: Object.fromEntries(serves.filter((p) => p !== 'app').map((p) => [p, {}])),
  serves,
  ...(serves.includes('app') && { app: APP(id) }),
});

export interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
}

// An upstream container: its document (undefined: 404), its /health, and every other call recorded.
export interface Upstream {
  address: string;
  doc: unknown;
  health: number;
  // How many times /health was read: the cloud host never reads it.
  healthReads: number;
  seen: Seen[];
  server: Server;
  // Answers first when set: true means it answered.
  custom?: (req: IncomingMessage, res: ServerResponse) => boolean;
}

const servers: Server[] = [];
export const closeUpstreams = () =>
  servers.splice(0).forEach((s) => (s.closeAllConnections(), s.close()));

export const upstream = async (doc: unknown): Promise<Upstream> => {
  const up = { doc, health: 200, healthReads: 0, seen: [] as Seen[] } as Upstream;
  up.server = createServer((req, res) => {
    if (up.custom?.(req, res)) return;
    const { method = '', url = '', headers } = req;
    if (url === '/health') return void (up.healthReads++, res.writeHead(up.health).end('{}'));
    if (url === '/.well-known/agentage-extension.json')
      return void (up.doc === undefined
        ? res.writeHead(404).end()
        : res.end(JSON.stringify(up.doc)));
    up.seen.push({ method, url, headers });
    res.writeHead(200, { 'set-cookie': 'up=1; Path=/', 'content-type': 'text/plain' }).end('ok');
  });
  servers.push(up.server);
  await new Promise<void>((resolve) => up.server.listen(0, '127.0.0.1', resolve));
  up.address = `http://127.0.0.1:${(up.server.address() as AddressInfo).port}`;
  return up;
};

export const quietLog = (): Log => createLog({ extension: 'host', part: 'api' }, () => undefined);
