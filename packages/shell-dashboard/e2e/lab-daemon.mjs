// A stand-in for the daemon's shell routes (platform P3) over the built shell, with three lab apps.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { appAsKit, EXTERNALS } from '../scripts/build.mjs';

const APPS = {
  probe: ['Probe', 'radar', 10],
  fixture: ['Fixture', 'box', 20],
  throws: ['Throws', 'bomb', 30],
};

const SESSIONS = {
  in: { user: { id: 'u1', email: 'lab@example.test', name: 'Alex Doe' }, host: 'local' },
  out: { user: null, host: 'platform', signIn: '/__sign-in?next=%2F' },
  hostile: { user: null, host: 'platform', signIn: 'javascript:alert(1)' },
};

export const createLab = (here, out) => {
  const rows = new Map();
  const clients = new Set();
  const send = (event, data) =>
    clients.forEach((res) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const buildApp = async (id, tag = 'one') => {
    const res = await build({
      entryPoints: [join(here, `apps/${id}.tsx`)],
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      write: false,
      external: EXTERNALS,
      plugins: [appAsKit],
      define: { BUILD: JSON.stringify(tag) },
    });
    const code = res.outputFiles[0].contents;
    const name = `app-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
    await mkdir(join(out, 'app', id), { recursive: true });
    await writeFile(join(out, 'app', id, name), code);
    const [title, icon, order] = APPS[id];
    rows.set(id, {
      id,
      version: '0.1.0',
      app: { title, icon, order, entry: `/app/${id}/${name}` },
    });
    return rows.get(id).app.entry;
  };
  // POST /__lab/session/out: a cloud host signed out, with its sign-in page; /in: back to the user.
  let session = 'in';
  // POST /__lab/deny-feed/<n>: the next n feed connections get a 502, as an edge does during a deploy.
  let denied = 0;
  const ready = Promise.all(Object.keys(APPS).map((id) => buildApp(id)));
  return {
    ready,
    discovery: () => ({ host: 'local', extensions: [...rows.values()] }),
    session: () => SESSIONS[session],
    has: (id) => rows.has(id),
    stream: (req, res) => {
      if (denied > 0) return (denied--, res.writeHead(502).end());
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    // POST /__lab/rebuild/probe/<tag>, /__lab/remove/<id>, /__lab/add/<id>
    control: async (op, id, tag) => {
      if (op === 'rebuild') send('app', { id, entry: await buildApp(id, tag) });
      if (op === 'remove') rows.delete(id) && send('extensions', { op, id });
      if (op === 'add') (await buildApp(id), send('extensions', { op, id }));
      if (op === 'deny-feed') denied = Number(id);
      if (op === 'session') ((session = id), send('session', { signedIn: id === 'in' }));
    },
  };
};
