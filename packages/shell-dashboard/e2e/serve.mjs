// The e2e server maps URLs as the daemon does (/shell/* -> dist/*, /app/* -> the app builds,
// any page -> index.html) over a lab daemon, plus the frame fixture and the prototype.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, buildShell, shellFileOf } from '../scripts/build.mjs';
import { createLab } from './lab-daemon.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, '../dist-e2e');
await buildAll(out);
await buildShell({ out, entry: 'e2e/fixture.tsx', name: 'fixture.js', html: 'fixture.html' });
const lab = createLab(here, out);
await lab.ready;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const json = (res, body, status = 200) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
const file = (path) => {
  if (path === '/prototype.html') return join(here, 'prototype/index.html');
  if (path === '/fixture.html') return join(out, 'fixture.html');
  const rel = path.startsWith('/app/') ? path.slice(1) : shellFileOf(path);
  const found = rel === null ? null : join(out, rel);
  return found?.startsWith(out) && existsSync(found) && statSync(found).isFile() ? found : null;
};

const port = Number(process.env.SHELL_E2E_PORT ?? 4291);
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = normalize(decodeURIComponent(url.pathname));
  const [, first = '', second = '', third = ''] = path.split('/');
  if (path === '/.well-known/agentage-host.json') return json(res, lab.discovery());
  if (path === '/shell/session') return json(res, lab.session());
  if (path === '/shell/events') return lab.stream(req, res);
  if (first === '__lab')
    return (await lab.control(second, third, path.split('/')[4]), json(res, {}));
  if (first === 'api')
    return json(res, { success: true, data: { msg: url.searchParams.get('msg') } });
  const found = file(path);
  if (found) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(found)] ?? 'application/octet-stream' });
    return createReadStream(found).pipe(res);
  }
  // A page: the shell's index.html, 404 when the first segment is not an installed app.
  const known = first === '' || lab.has(first);
  res.writeHead(known ? 200 : 404, { 'Content-Type': 'text/html' });
  createReadStream(join(out, 'index.html')).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`shell e2e on ${port}`));
