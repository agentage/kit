// The denied-read matrix: one sealed spy child, every target x every way to read it.
// Usage: node deny.mjs <node-binary> [daemonPort]
import { symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative } from 'node:path';
import { CFG, startChild } from './harness.mjs';

const [node, key = 'spy'] = process.argv.slice(2);
// A stand-in for the daemon's /host/extensions on a free port: the network question (e).
const daemon = createServer((req, res) => res.end(`daemon saw ${req.method} ${req.url}`));
await new Promise((ok) => daemon.listen(0, '127.0.0.1', ok));
const dport = daemon.address().port;

const c = await startChild({ node, key, sealed: true, fresh: true });
const data = join(CFG, 'data', key);
const T = {
  'secrets.json': join(CFG, 'secrets.json'),
  'settings.json': join(CFG, 'settings.json'),
  'installation.json': join(CFG, 'installation.json'),
  'daemon.json': join(CFG, 'daemon.json'),
  'data/other/x.txt': join(CFG, 'data/other/x.txt'),
  'run/other/token': join(CFG, 'run/other/token'),
};
const ask = async (how, path) => {
  const q = new URLSearchParams({ how, path });
  return (await fetch(`http://127.0.0.1:${c.port}/api/spy/read?${q}`)).json();
};
// Content is never printed: READ means the bytes came back; a realpath answer is only a path.
const short = (r, how) => {
  if (!r.ok) return r.code;
  if (/^realpath/.test(how)) return 'PATH (no content)';
  if (how === 'has' || how === 'fetch') return r.out.slice(0, 50);
  return 'READ';
};
const HOWS = ['read', 'relative', 'promises', 'stream', 'open', 'stat', 'exists', 'realpath',
  'realpathNative', 'symlinkAbs', 'symlinkRel', 'hardlink', 'preLink', 'copy', 'rename', 'importJson', 'procRoot',
  'traversal', 'traversalRaw', 'buffer', 'url', 'require', 'loadEnvFile', 'sqlite', 'openAsBlob', 'watch', 'has'];
const rows = [];
for (const [name, abs] of Object.entries(T)) {
  const row = { target: name };
  for (const how of HOWS) {
    // relative: from the child cwd (its data dir); symlinkRel: a relative target from its own folder
    const path = ['relative', 'symlinkRel'].includes(how) ? relative(data, abs)
      : how.startsWith('traversal') ? relative(CFG, abs) : abs;
    if (how === 'preLink') {
      // made by the daemon side (no seal) inside the child's own folder, then read by the child
      const l = join(data, `pre-${name.replace(/\W/g, '_')}`);
      symlinkSync(abs, l);
      row[how] = short(await ask('read', l), 'read');
    } else row[how] = short(await ask(how, path), how);
  }
  rows.push(row);
}
const dirs = { 'data/other': join(CFG, 'data/other'), 'run/other': join(CFG, 'run/other'), cfg: CFG };
for (const [name, abs] of Object.entries(dirs))
  rows.push({ target: `${name}/ (dir)`, opendir: short(await ask('opendir', abs), 'opendir'), readdir: short(await ask('readdir', abs), 'readdir') });
rows.push({ target: 'missing file (existence oracle)', realpath: (await ask('realpath', join(CFG, 'nope.json'))).code ?? 'PATH', realpathNative: (await ask('realpathNative', join(CFG, 'nope.json'))).code ?? 'PATH' });
console.log(JSON.stringify(rows));
const extra = {
  node: process.version,
  ownData: short(await ask('read', join(data, 'nothing'))),
  ownWriteThenRead: short(await ask('tmpdir', ''), 'tmpdir'),
  writeSecrets: short(await ask('write', T['secrets.json'])),
  writeOtherData: short(await ask('write', T['data/other/x.txt'])),
  procFd: short(await ask('procFd', '')),
  spawn: short(await ask('spawn', '')),
  worker: short(await ask('worker', '')),
  fetchDaemon: short(await ask('fetch', `http://127.0.0.1:${dport}/host/extensions`), 'fetch'),
  etcSsl: short(await ask('stat', '/etc/ssl/certs/ca-certificates.crt')),
  zoneinfo: short(await ask('stat', '/usr/share/zoneinfo/Europe/Prague')),
};
console.log(JSON.stringify(extra));
console.log(JSON.stringify({ node: await (await fetch(`http://127.0.0.1:${c.port}/health`)).json().then((h) => h.status) }));
await c.stop();
daemon.close();
