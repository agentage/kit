// node packages/apphost/scripts/image-smoke.mjs IMAGE: the app host image starts healthy as user node,
// has no local flag, and drains inside the 10 s stop grace of the stack. Needs Docker.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = '/app/node_modules/.bin/agentage-apphost-cloud';
// /health is 503 until the first discovery pass ends: wait for 200 inside this bound.
const READY_MS = 30_000;
const HEALTHY_MS = 45_000;

const image = process.argv[2];
if (!image) throw new Error('usage: image-smoke.mjs IMAGE');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'apphost-smoke-'));
writeFileSync(join(dir, 'installation.json'), JSON.stringify({ host: 'smoke', extensions: [] }));
writeFileSync(join(dir, 'upstreams.json'), '[]');
// The image user (node, uid 1000) is not the runner user: the files must be readable by all.
chmodSync(dir, 0o755);
const env = [
  'AGENTAGE_URL=https://smoke.example.org',
  'AGENTAGE_CORE_URL=https://core.example.org',
  'AGENTAGE_INSTALLATION_FILE=/run/host/installation.json',
  'AGENTAGE_UPSTREAMS_FILE=/run/host/upstreams.json',
];
// The stack runs the image with no command: so does the smoke.
const id = docker(
  'run',
  '-d',
  '-v',
  `${dir}:/run/host:ro`,
  ...env.flatMap((e) => ['-e', e]),
  image
);
const results = [];
const check = (name, ok, got) =>
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${got}`}`);
const running = () => docker('inspect', '-f', '{{.State.Running}}', id) === 'true';

// The status of /health on 127.0.0.1 inside the container; 0 when it does not answer yet.
const healthStatus = () => {
  const code = `fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>console.log(r.status),()=>console.log(0))`;
  const r = spawnSync('docker', ['exec', id, 'node', '-e', code], { encoding: 'utf8' });
  return Number(r.stdout.trim()) || 0;
};

// Poll until `done(value)` or the bound; a container that exits stops the wait at once.
const waitFor = async (read, done, ms) => {
  let value = read();
  for (const end = Date.now() + ms; !done(value) && Date.now() < end && running();) {
    await sleep(1000);
    value = read();
  }
  return value;
};

try {
  const entry = docker('inspect', '-f', '{{json .Config.Entrypoint}} {{json .Config.Cmd}}', image);
  check('entrypoint is the cloud bin, no command', entry === `["${BIN}"] null`, entry);
  const status = await waitFor(healthStatus, (s) => s === 200, READY_MS);
  check(
    '/health on 127.0.0.1 answers 200 (503 only before the first pass)',
    status === 200,
    status
  );
  const inspectHealth = () => docker('inspect', '-f', '{{.State.Health.Status}}', id);
  const health = await waitFor(inspectHealth, (h) => h !== 'starting', HEALTHY_MS);
  check('the image health check is healthy', health === 'healthy', health);
  const user = docker('exec', id, 'id', '-un');
  check('runs as user node', user === 'node', user);
  const flag = docker('exec', id, 'sh', '-c', 'echo "${STUB_LOOPBACK_HTTP:-absent}"');
  check('the local flag is absent', flag === 'absent', flag);
  const t0 = Date.now();
  docker('stop', '-t', '10', id);
  const [ms, code] = [Date.now() - t0, docker('inspect', '-f', '{{.State.ExitCode}}', id)];
  const drained = code === '0' && ms < 10_000;
  check('SIGTERM drains and exits 0 inside the 10 s grace', drained, `exit ${code} after ${ms} ms`);
} catch (err) {
  check('the smoke ran', false, err.message);
} finally {
  if (results.some((r) => r.startsWith('FAIL'))) console.log(docker('logs', id));
  docker('rm', '-f', id);
}
for (const r of results) console.log(r);
process.exit(results.every((r) => r.startsWith('PASS')) ? 0 : 1);
