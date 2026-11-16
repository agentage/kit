// Spike S1.1.2 B0: fork a kit host child the way child.ts does, with or without the C2 flags.
// Usage: node harness.mjs <node-binary> <id> <sealed 0|1> <fresh 0|1> [route]
// Prints one JSON line: ms from spawn to first 200, RSS, the stderr tail.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const B = process.env.S112_BASE ?? join(homedir(), '.cache/s112-b0');
export const CFG = join(B, 'cfg');
export const KIT_NM = join(B, 'prefix/lib/node_modules/@agentage/cli/node_modules');
const MAIN = join(KIT_NM, '@agentage/extension/dist/host/main.js');
const PKG = {
  probe7: ['probe', 'probe@0.7.0', '@agentage/extension-probe', '/api/probe/echo?msg=hi'],
  probe6: ['probe6', 'probe@0.6.2', '@agentage/extension-probe', '/api/probe/echo?msg=hi'],
  spy: ['spy', 'spy@0.0.1', 's112-b0-spy', '/api/spy/read?path=/etc/os-release'],
  spy2: ['spy2', 'spy@0.0.2', 's112-b0-spy', '/api/spy/read?path=/etc/os-release'],
};

// The C2 flag list; EXTRA_READ adds entries the spike found to be needed.
export const sealFlags = (id, dir) => {
  const run = join(CFG, 'run', id);
  const data = join(CFG, 'data', id);
  const extra = (process.env.EXTRA_READ ?? '').split(',').filter(Boolean).map((p) => p.replace('{id}', id));
  return [
    '--permission',
    `--allow-fs-read=${KIT_NM}`,
    `--allow-fs-read=${dir}`,
    `--allow-fs-read=${join(CFG, 'extensions')}`,
    `--allow-fs-read=${run}`,
    `--allow-fs-write=${run}`,
    `--allow-fs-read=${data}`,
    `--allow-fs-write=${data}`,
    ...extra.map((p) => `--allow-fs-read=${p}`),
    ...(process.env.EXTRA_WRITE ?? '').split(',').filter(Boolean).map((p) => `--allow-fs-write=${p.replace('{id}', id)}`),
  ];
};

const rssKb = (pid) => {
  const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
  return m ? Number(m[1]) : 0;
};

const firstOk = async (url, until) => {
  while (Date.now() < until) {
    const r = await fetch(url).catch(() => null);
    if (r?.status === 200) return r.text();
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error(`no 200 from ${url}`);
};

export const startChild = async ({ node, key, sealed, fresh, cwd }) => {
  const [id, tree, name, route] = PKG[key];
  const dir = join(CFG, 'extensions/trees', tree, 'node_modules', name);
  const run = join(CFG, 'run', id);
  const data = join(CFG, 'data', id);
  if (fresh) rmSync(data, { recursive: true, force: true });
  mkdirSync(join(run, 'tmp'), { recursive: true });
  mkdirSync(join(run, 'secrets'), { recursive: true, mode: 0o700 });
  mkdirSync(data, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TMPDIR: join(run, 'tmp'),
    PORT: '0',
    AGENTAGE_EXTENSION_DIR: dir,
    AGENTAGE_DATA_DIR: process.env.DATA_SUB ? join(data, process.env.DATA_SUB) : data,
    AGENTAGE_SETTINGS: '{}',
    AGENTAGE_SECRETS_DIR: join(run, 'secrets'),
    AGENTAGE_ORIGIN: 'http://127.0.0.1:4299',
  };
  // DROP=<n>: leave out the n-th grant (ablation); AUDIT=1: log denials instead of throwing (24.22+)
  const drop = process.env.DROP ? Number(process.env.DROP) : -1;
  const sealedFlags = sealFlags(id, dir).filter((_, i) => i !== drop);
  const audit = process.env.AUDIT ? ['--permission-audit'] : [];
  const flags = sealed ? [...sealedFlags.map((f) => (audit.length && f === '--permission' ? audit[0] : f)), '--no-experimental-sqlite'] : [];
  const t0 = performance.now();
  const child = spawn(node, [...flags, MAIN], {
    env,
    cwd: cwd ?? data,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let tail = '';
  let full = '';
  child.stderr.on('data', (c) => ((full += c), (tail = (tail + c).slice(-3000))));
  child.stdout.on('data', (c) => (tail = (tail + c).slice(-3000)));
  const port = await new Promise((ok, no) => {
    child.on('message', (m) => m?.type === 'ready' && ok(m.port));
    child.once('exit', (code) => no(new Error(`exit ${code}: ${tail.slice(-1500)}`)));
    setTimeout(() => no(new Error(`timeout: ${tail.slice(-1500)}`)), 60_000).unref();
  });
  const body = await firstOk(`http://127.0.0.1:${port}${route}`, Date.now() + 60_000);
  const ms = Math.round(performance.now() - t0);
  const rss = Math.round(rssKb(child.pid) / 1024);
  const stop = () =>
    new Promise((ok) => {
      if (child.exitCode !== null) return ok();
      child.once('exit', ok);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    });
  return { port, ms, rss, body, tail: () => tail, full: () => full, stop, pid: child.pid };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [node, key, sealed, fresh] = process.argv.slice(2);
  const c = await startChild({ node, key, sealed: sealed === '1', fresh: fresh === '1' }).catch(
    (e) => ({ error: e.message })
  );
  if (c.error) console.log(JSON.stringify({ key, sealed, fresh, error: c.error }));
  else {
    await new Promise((ok) => setTimeout(ok, 1500));
    const rssSettled = Math.round(rssKb(c.pid) / 1024);
    console.log(JSON.stringify({ key, sealed, fresh, ms: c.ms, rss: c.rss, rssSettled, body: c.body.slice(0, 120) }));
    await c.stop();
  }
}
