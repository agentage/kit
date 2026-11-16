// The e2e server: the built shell at /, the frame fixture at /fixture.html, the prototype at /prototype.html.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, buildShell } from '../scripts/build.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, '../dist-e2e');
await buildAll(out);
await buildShell({ out, entry: 'e2e/fixture.tsx', name: 'fixture.js', html: 'fixture.html' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const file = (url) => {
  const path = normalize(decodeURIComponent(new URL(url, 'http://x').pathname));
  if (path === '/prototype.html') return join(here, 'prototype/index.html');
  const found = join(out, path);
  if (found.startsWith(out) && existsSync(found) && statSync(found).isFile()) return found;
  return join(out, 'index.html');
};
const port = Number(process.env.SHELL_E2E_PORT ?? 4291);
createServer((req, res) => {
  const path = file(req.url ?? '/');
  res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`shell e2e on ${port}`));
