import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach } from 'vitest';

export interface Seen {
  url: URL;
  user: string | undefined;
  key: string | undefined;
  body: string;
}

interface Reply {
  status?: number;
  body?: string;
  code?: string;
  wait?: number;
  // Sends the headers and part of the body, then closes the socket.
  cut?: boolean;
}

type Answer = (seen: Seen) => Reply;

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const bodyOf = async (req: IncomingMessage) => {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return text;
};

// A stand-in for the ClickHouse HTTP interface: records each request, answers as told.
export const fakeClickhouse = async (answer: Answer) => {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    void bodyOf(req).then(async (body) => {
      const one = { url: new URL(req.url ?? '/', 'http://x'), body } as Seen;
      one.user = req.headers['x-clickhouse-user'] as string;
      one.key = req.headers['x-clickhouse-key'] as string;
      seen.push(one);
      const a = answer(one);
      if (a.wait) await new Promise((ok) => setTimeout(ok, a.wait));
      if (a.code) res.setHeader('X-ClickHouse-Exception-Code', a.code);
      if (!a.cut) return void res.writeHead(a.status ?? 200).end(a.body ?? '');
      res.writeHead(200, { 'Content-Length': '1000' }).write('{"n":1}\n');
      setTimeout(() => res.socket?.destroy(), 20);
    });
  });
  servers.push(server);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return { seen, url: `http://logs:p%40ss@127.0.0.1:${port}/platform_logs` };
};

export const closedPort = async () => {
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  await new Promise((ok) => server.close(ok));
  return port;
};
