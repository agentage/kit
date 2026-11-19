import { type IncomingMessage } from 'node:http';
import { targetOf } from './proxy.js';

const DOC_PATH = '/.well-known/agentage-extension.json';
// A discovery document is a few KiB; a bigger answer is refused, never held in memory.
export const MAX_DOC_BYTES = 256 * 1024;

const bodyOf = (res: IncomingMessage, fail: (err: Error) => void) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DOC_BYTES) fail(new Error(`document over ${MAX_DOC_BYTES} bytes`));
      else chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

// node:http, not fetch: fetch drops Host, and the kit names the document's host after Host.
export const readDocument = (
  address: string,
  ms: number,
  headers: Record<string, string> = {}
): Promise<unknown> =>
  new Promise((resolve) => {
    const { send, host, port, servername } = targetOf(address);
    const signal = AbortSignal.timeout(ms);
    const options = { host, port, servername, path: DOC_PATH, headers, signal, agent: false };
    const req = send(options, (res) => {
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
      void bodyOf(res, (err) => req.destroy(err)).then((text) =>
        resolve(ok ? parse(text) : undefined)
      );
      res.on('error', () => resolve(undefined));
    });
    req.on('error', () => resolve(undefined));
    req.end();
  });
