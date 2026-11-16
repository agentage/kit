import { type RequestHandler, type Response } from 'express';

// K7: what the open shell page follows; each event names what to fetch again.
export type ShellEvent = 'extensions' | 'app' | 'session';

export interface ShellEvents {
  send(event: ShellEvent, data: unknown): void;
  stream: RequestHandler;
}

// A comment line now and then, so an idle connection is not cut by a proxy or a browser.
export const HEARTBEAT_MS = 25_000;

export const shellEvents = (heartbeatMs = HEARTBEAT_MS): ShellEvents => {
  const open = new Set<Response>();
  const send = (event: ShellEvent, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of open) res.write(frame);
  };
  // GET /shell/events: server-sent events; the daemon's stop closes every stream.
  const stream: RequestHandler = (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    open.add(res);
    const beat = setInterval(() => res.write(': beat\n\n'), heartbeatMs).unref();
    req.on('close', () => {
      clearInterval(beat);
      open.delete(res);
    });
  };
  return { send, stream };
};
