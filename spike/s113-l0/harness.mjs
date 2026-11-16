// SPIKE s113-l0 (not for merge): save -> watch -> build -> reload -> first 200 with the new answer.
// node harness.mjs <mode> [runs]   modes: tsc-inc tsc-warm esbuild npm ui ui-bundle load bad-syntax bad-start
import { execFile, spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const KIT = process.env.KIT ?? new URL('../../packages/extension/dist/', import.meta.url).pathname;
const PKG = process.env.PROBE;
const CONFIG = process.env.CONFIG;
const [mode = 'tsc-inc', runsArg = '10'] = process.argv.slice(2);
const RUNS = Number(runsArg);
const API = join(PKG, 'src/api/index.ts');
const UI = join(PKG, 'src/ui/echo.tsx');
const TSC = join(PKG, 'node_modules/typescript/bin/tsc');
const ESBUILD = join(PKG, 'node_modules/.bin/esbuild');

const { startDaemon } = await import(join(KIT, 'host/daemon/daemon.js'));
const { forkLaunch } = await import(join(KIT, 'host/daemon/child.js'));

// The child's fork -> port report, and its store open (a log line on stderr).
const forks = [];
const launch = async (spec) => {
  const f = { forkStart: Date.now() };
  forks.push(f);
  const child = await forkLaunch()(spec);
  f.port = Date.now();
  return child;
};
const write = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  const text = String(chunk);
  const m = /"msg":"spike store open".*?"ms":(\d+)/.exec(text);
  if (m && forks.length) forks.at(-1).storeMs = Number(m[1]);
  if (process.env.QUIET && !/error|Error/.test(text)) return true;
  return write(chunk, ...rest);
};

await rm(CONFIG, { recursive: true, force: true });
const daemon = await startDaemon(
  { configDir: CONFIG, port: 0, version: 'spike', startedBy: 'spike' },
  launch
);
const base = `http://127.0.0.1:${daemon.port}`;
const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());
const added = await post('/host/extensions', { source: PKG });
if (added.data?.state !== 'running') throw new Error(JSON.stringify(added));

const echo = () =>
  fetch(`${base}/api/probe/echo?msg=hi`).then(async (r) => ({ status: r.status, body: await r.text() }));

// Staging: dist.next starts as a copy of the live dist (its tsbuildinfo travels with it).
const stage = async () => {
  await rm(join(PKG, 'dist.next'), { recursive: true, force: true });
  await cp(join(PKG, 'dist'), join(PKG, 'dist.next'), { recursive: true });
};

const sh = (cmd, args) =>
  run(cmd, args, { cwd: PKG, maxBuffer: 1 << 24 }).then(
    () => ({ ok: true }),
    (err) => ({ ok: false, text: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() })
  );

const API_SRC = ['src/api', 'src/lib', 'src/cli', 'src/mcp', 'src/pages', 'src/worker'];
const builders = {
  'tsc-inc': () =>
    sh('node', [TSC, '-p', 'tsconfig.build.json', '--incremental', '--outDir', 'dist.next']),
  esbuild: async () => {
    const { stdout } = await run('find', [...API_SRC, '-name', '*.ts', '!', '-name', '*.test.ts'], {
      cwd: PKG,
    });
    const files = stdout.trim().split('\n');
    return sh(ESBUILD, [...files, '--outdir=dist.next', '--outbase=src', '--format=esm', '--platform=node', '--log-level=error']);
  },
  npm: () => sh('npm', ['run', 'build', '--silent']),
  ui: () => sh('npm', ['run', 'build', '--silent']),
  'ui-bundle': () => sh(join(PKG, 'node_modules/.bin/agentage-widget'), ['bundle']),
};

// tsc --watch kept warm into .build; a "Found 0 errors" line = one build done.
let warm;
const warmDone = [];
if (mode === 'tsc-warm') {
  await rm(join(PKG, '.build'), { recursive: true, force: true });
  warm = spawn('node', [TSC, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput', '--incremental', '--outDir', '.build'], { cwd: PKG });
  let buf = '';
  warm.stdout.on('data', (d) => {
    buf += d;
    const m = /Found (\d+) errors?\. Watching/.exec(buf);
    if (m) {
      buf = '';
      warmDone.splice(0).forEach((r) => r({ ok: m[1] === '0', at: Date.now() }));
    }
  });
  await new Promise((r) => warmDone.push(r));
}
const nextWarm = () => new Promise((r) => warmDone.push(r));

const inPlace = mode === 'npm' || mode === 'ui' || mode === 'ui-bundle';
const file = mode.startsWith('ui') ? UI : API;
const original = await readFile(file, 'utf8');
let good = false;
const edit = (n) => {
  if (good) return original.replace("v: 'v0'", `v: 'v${n}'`);
  if (file === UI) return original.replace('<p>{answer}</p>', `<p data-v="${n}">{answer}</p>`);
  if (mode === 'bad-syntax') return original.replace("v: 'v0',", "v: 'v0',,, (");
  if (mode === 'bad-start')
    return original.replace('const router = Router();', "const router = Router();\n  throw new Error('spike: create throws');");
  return original.replace("v: 'v0'", `v: 'v${n}'`);
};

// One save: the watcher (200 ms debounce) -> build -> reload; the poller finds the new answer.
const once = (n, want) =>
  new Promise((resolve) => {
    const t = {};
    let timer;
    const w = watch(join(PKG, 'src'), { recursive: true }, () => {
      t.event ??= Date.now();
      clearTimeout(timer);
      timer = setTimeout(go, 200);
    });
    const go = async () => {
      w.close();
      t.debounced = Date.now();
      const built = warm ? await warmP : await builders[builderOf()]();
      t.built = Date.now();
      if (warm) {
        if (built.ok) await cp(join(PKG, '.build'), join(PKG, 'dist.next'), { recursive: true });
        t.built = Date.now();
      }
      if (!built.ok) return resolve({ ...t, failed: built.text ?? 'build failed' });
      if (inPlace) await rm(join(PKG, 'dist.next'), { recursive: true, force: true });
      const forkAt = forks.length;
      t.reloadSent = Date.now();
      const r = await post('/host/extensions/probe/reload');
      t.reloadDone = Date.now();
      const f = forks[forkAt] ?? {};
      for (;;) {
        const got = await echo().catch(() => ({ status: 0, body: '' }));
        if (got.status === 200 && (want === undefined || got.body.includes(want))) break;
        await new Promise((r2) => setTimeout(r2, 5));
      }
      t.first200 = Date.now();
      resolve({ ...t, marks: r.data?.marks, f, reply: r.data, forks: forks.slice(forkAt) });
    };
    let warmP;
    if (warm) warmP = nextWarm();
    writeFile(file, edit(n)).then(async () => (t.saved = (await stat(file)).mtimeMs));
  });
const builderOf = () => (mode.startsWith('bad') ? 'tsc-inc' : mode === 'load' ? 'tsc-inc' : mode);

const row = (t) => {
  const m = t.marks ?? {};
  return {
    debounce: Math.round(t.debounced - t.saved),
    build: t.built - t.debounced,
    stop: m.haltEnd - m.haltStart,
    swap: (m.swapEnd ?? m.haltEnd) - m.haltEnd,
    forkToPort: t.f.port - t.f.forkStart,
    store: t.f.storeMs,
    health: m.startEnd - t.f.port,
    first200: t.first200 - t.reloadDone,
    total: Math.round(t.first200 - t.saved),
  };
};

// 20 requests per second while it runs: lost (no answer), failed (not 200), and the longest wait.
const load = () => {
  const stats = { sent: 0, ok: 0, failed: 0, lost: 0, waits: [] };
  const timer = setInterval(() => {
    stats.sent += 1;
    const t0 = Date.now();
    fetch(`${base}/api/probe/echo?msg=hi`, { signal: AbortSignal.timeout(35_000) })
      .then(async (r) => {
        await r.text();
        stats[r.status === 200 ? 'ok' : 'failed'] += 1;
        stats.waits.push(Date.now() - t0);
      })
      .catch(() => (stats.lost += 1));
  }, 50);
  return { stats, stop: () => clearInterval(timer) };
};

const results = [];
try {
  if (!inPlace) await stage();
  if (mode === 'bad-syntax' || mode === 'bad-start') {
    console.log('row before', JSON.stringify(await post('/api/probe/spike')));
    const l = load();
    const t = await once(1, mode === 'bad-start' ? "v0" : undefined);
    await new Promise((r) => setTimeout(r, 1000));
    l.stop();
    await new Promise((r) => setTimeout(r, 500));
    const after = await echo();
    const rowAfter = await fetch(`${base}/api/probe/spike`).then((r) => r.text());
    const w = l.stats.waits.sort((a, b) => a - b);
    // Recovery: a good save after the bad one goes live, from a clean dist.next.
    good = true;
    await stage();
    const rec = await once(2, '"v":"v2"');
    const recovered = { total: rec.first200 - rec.saved, failed: rec.failed, state: rec.reply?.state };
    console.log(JSON.stringify({ mode, recovered, failedBuild: t.failed?.slice(0, 400), reply: t.reply, after, rowAfter, load: { ...l.stats, waits: undefined, maxWait: w.at(-1), over200ms: w.filter((x) => x > 200).length }, timing: t.failed ? undefined : { total: t.first200 - t.saved, reload: t.reloadDone - t.reloadSent } }, null, 1));
  } else {
    const l = mode === 'load' ? load() : undefined;
    for (let n = 1; n <= RUNS; n++) {
      const t = await once(n, mode.startsWith('ui') ? undefined : `"v":"v${n}"`);
      if (t.failed) throw new Error(t.failed);
      results.push(row(t));
      if (!inPlace) await stage();
      await new Promise((r) => setTimeout(r, 300));
    }
    if (l) {
      await new Promise((r) => setTimeout(r, 1000));
      l.stop();
      await new Promise((r) => setTimeout(r, 1000));
      const w = l.stats.waits.sort((a, b) => a - b);
      console.log('LOAD', JSON.stringify({ ...l.stats, waits: undefined, maxWait: w.at(-1), over200ms: w.filter((x) => x > 200).length, p50: w[w.length >> 1] }));
    }
    const keys = Object.keys(results[0]);
    const med = (k) => [...results.map((r) => r[k])].sort((a, b) => a - b)[results.length >> 1];
    const max = (k) => Math.max(...results.map((r) => r[k]));
    console.log('RESULT', mode, JSON.stringify(Object.fromEntries(keys.map((k) => [k, `${med(k)} / ${max(k)}`]))));
    console.log('RUNS', JSON.stringify(results));
  }
} finally {
  await writeFile(file, original);
  warm?.kill();
  await daemon.stop();
  await rm(join(PKG, 'dist.next'), { recursive: true, force: true });
}
