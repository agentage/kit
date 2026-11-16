import { Router } from 'express';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Which call of a two-step trick failed: the link, or the read through it.
const step = (name, fn) => { try { return fn(); } catch (err) { err.code = `${err.code ?? err.name}@${name}`; throw err; } };

// Each "how" is one way to read `path`; the answer is the first bytes or the error code.
const own = () => process.env.AGENTAGE_DATA_DIR;
const HOW = {
  read: (p) => fs.readFileSync(p, 'utf8'),
  relative: (p) => fs.readFileSync(p, 'utf8'), // caller passes a relative path, cwd as given
  promises: (p) => fs.promises.readFile(p, 'utf8'),
  stream: (p) => new Promise((ok, no) => { let s = ''; fs.createReadStream(p, 'utf8').on('data', (c) => (s += c)).on('end', () => ok(s)).on('error', no); }),
  open: (p) => { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(200); const n = fs.readSync(fd, b); return b.subarray(0, n).toString(); },
  opendir: (p) => { const d = fs.opendirSync(p); const out = []; let e; while ((e = d.readSync())) out.push(e.name); d.closeSync(); return out.join(','); },
  readdir: (p) => fs.readdirSync(p).join(','),
  stat: (p) => `size=${fs.statSync(p).size}`,
  exists: (p) => `exists=${fs.existsSync(p)}`,
  realpath: (p) => fs.realpathSync(p),
  realpathNative: (p) => fs.realpathSync.native(p),
  symlinkAbs: (p) => { const l = join(own(), `abs-${Date.now()}`); step('symlinkSync', () => fs.symlinkSync(p, l)); return step('read', () => fs.readFileSync(l, 'utf8')); },
  symlinkRel: (p) => { const l = join(own(), `rel-${Date.now()}`); step('symlinkSync', () => fs.symlinkSync(p, l)); return step('read', () => fs.readFileSync(l, 'utf8')); },
  hardlink: (p) => { const l = join(own(), `hard-${Date.now()}`); step('linkSync', () => fs.linkSync(p, l)); return step('read', () => fs.readFileSync(l, 'utf8')); },
  traversal: (p) => fs.readFileSync(join(own(), '..', '..', p), 'utf8'),
  traversalRaw: (p) => fs.readFileSync(`${own()}/../../${p}`, 'utf8'),
  buffer: (p) => fs.readFileSync(Buffer.from(p), 'utf8'),
  url: (p) => fs.readFileSync(new URL(`file://${p}`), 'utf8'),
  require: (p) => JSON.stringify(createRequire(join(own(), 'x.js'))(p)).slice(0, 80),
  loadEnvFile: (p) => { process.loadEnvFile(p); return 'loaded'; },
  sqlite: async (p) => { const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(p, { readOnly: true }); return 'opened'; },
  openAsBlob: async (p) => (await (await fs.openAsBlob(p)).text()),
  watch: (p) => { fs.watch(p).close(); return 'watched'; },
  copy: (p) => { const l = join(own(), `copy-${Date.now()}`); fs.copyFileSync(p, l); return fs.readFileSync(l, 'utf8'); },
  rename: (p) => { const l = join(own(), `moved-${Date.now()}`); fs.renameSync(p, l); return 'renamed'; },
  write: (p) => { fs.writeFileSync(p, 'x'); return 'written'; },
  importJson: async (p) => JSON.stringify((await import(`file://${p}`, { with: { type: 'json' } })).default).slice(0, 80),
  procRoot: (p) => fs.readFileSync(`/proc/self/root${p}`, 'utf8'),
  procFd: () => fs.readdirSync('/proc/self/fd').join(','),
  spawn: () => { const r = spawnSync('cat', ['/etc/os-release']); if (r.error) throw r.error; return String(r.stdout); },
  worker: () => { new Worker('1', { eval: true }); return 'worker started'; },
  tmpdir: () => { const f = join(tmpdir(), `t-${Date.now()}`); fs.writeFileSync(f, 'ok'); return `${f}: ${fs.readFileSync(f, 'utf8')}`; },
  has: (p) => `has=${process.permission?.has('fs.read', p)}`,
  fetch: async (p) => { const r = await fetch(p); return `${r.status} ${(await r.text()).slice(0, 80)}`; },
};

export const create = () => {
  const router = Router();
  router.get('/read', async (req, res) => {
    const how = String(req.query.how ?? 'read');
    const path = String(req.query.path ?? '');
    try {
      const out = await HOW[how](path);
      res.json({ how, path, ok: true, out: String(out).slice(0, 120) });
    } catch (err) {
      res.json({ how, path, ok: false, code: err.code ?? err.name, msg: String(err.message).slice(0, 160) });
    }
  });
  return router;
};
