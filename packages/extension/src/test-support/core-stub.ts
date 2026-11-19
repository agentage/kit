import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface Stub {
  url: string;
  hits: string[];
  close: () => Promise<void>;
}

// A core on an ephemeral loopback port; each request is logged as `METHOD path`.
export const startStub = async (handler: Handler): Promise<Stub> => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return { url: `http://127.0.0.1:${port}`, hits, close };
};

// A port that was just free: nothing listens on it.
export const closedPort = async (): Promise<string> => {
  const stub = await startStub(() => undefined);
  await stub.close();
  return stub.url;
};

export const json =
  (status: number, body: unknown): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

export const text =
  (status: number, body: string): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'text/html' });
    res.end(body);
  };

// Takes the request and never answers.
export const silent: Handler = () => undefined;
