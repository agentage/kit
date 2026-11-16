// Spike stand-in for the daemon routes: /, /{id}/*, /shell/*, /app/{id}/*, /discovery, /shell/events (SSE).
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { out } from './build.mjs';

export const startServer = (rows) => {
  const app = express();
  const clients = new Set();
  const html = readFileSync(new URL('./src/shell/index.html', import.meta.url), 'utf8');
  app.use(
    '/shell',
    express.static(join(out, 'shell'), {
      setHeaders: (r) => r.setHeader('Cache-Control', 'no-cache'),
    })
  );
  app.use(
    '/app',
    express.static(join(out, 'app'), {
      setHeaders: (r, p) =>
        r.setHeader(
          'Cache-Control',
          p.endsWith('index.js') ? 'no-cache' : 'public, max-age=31536000, immutable'
        ),
    })
  );
  app.get('/discovery', (_q, r) => void r.json(rows));
  app.get('/shell/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': open\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  app.get(/^\/(?!shell|app).*/, (_q, r) => void r.type('html').send(html));
  const send = (event, data) =>
    clients.forEach((c) => c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  return new Promise((ok) => {
    const srv = app.listen(0, '127.0.0.1', () =>
      ok({
        port: srv.address().port,
        send,
        close: () => (clients.forEach((c) => c.end()), srv.close()),
      })
    );
  });
};
