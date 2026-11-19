import { createHash } from 'node:crypto';
import { type RequestHandler, type Response } from 'express';

// K7: what the open shell page follows; each event names what to fetch again.
export type ShellEvent = 'extensions' | 'app' | 'session';

export interface ShellEvents {
  send(event: ShellEvent, data: unknown): void;
  stream: RequestHandler;
}

// A comment line now and then, so an idle connection is not cut by a proxy or a browser.
export const HEARTBEAT_MS = 25_000;

// A tab that does not read: after this many writes in a row that the socket refused, the stream is dropped.
export const STALLED_WRITES = 32;

// The id of a host document (the stub router's docId): a reconnect names the document the page saw.
export const docId = (doc: unknown): string =>
  createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 12);

// With current (a cloud host), each frame carries the id of the host document.
const idLine = (current?: () => unknown) => (current ? `id: ${docId(current())}\n` : '');

export const shellEvents = (heartbeatMs = HEARTBEAT_MS, current?: () => unknown): ShellEvents => {
  const open = new Map<Response, number>();
  const write = (res: Response, frame: string) => {
    const refused = res.write(frame) ? 0 : (open.get(res) ?? 0) + 1;
    if (refused < STALLED_WRITES) return void open.set(res, refused);
    open.delete(res);
    res.destroy();
  };
  const send = (event: ShellEvent, data: unknown) => {
    const frame = `${idLine(current)}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...open.keys()]) write(res, frame);
  };
  // GET /shell/events: server-sent events; the daemon's stop closes every stream.
  const stream: RequestHandler = (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const id = idLine(current);
    res.write(`retry: 1000\n${id}\n`);
    open.set(res, 0);
    // After a deploy the page reconnects with the id of the document it still shows.
    const seen = current && req.headers['last-event-id'];
    if (seen && `id: ${seen}\n` !== id)
      write(res, `${id}event: extensions\ndata: {"op":"update"}\n\n`);
    const beat = setInterval(() => res.write(': beat\n\n'), heartbeatMs).unref();
    req.on('close', () => {
      clearInterval(beat);
      open.delete(res);
    });
  };
  return { send, stream };
};
