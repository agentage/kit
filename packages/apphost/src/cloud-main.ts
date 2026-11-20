#!/usr/bin/env node
import { runCheck } from './cloud-check-mode.js';
import { stopOnSignal } from './cloud-drain.js';
import { cloudLog, startCloudHost } from './cloud-host.js';
import { PROGRAM_VERSION } from './program-version.js';

// The cloud entry (bin agentage-apphost-cloud): the only way the program listens on 0.0.0.0.
const exit = (code: number) => process.exit(code);

const start = async () => {
  const log = cloudLog(PROGRAM_VERSION);
  try {
    const host = await startCloudHost(process.env, { log });
    log.info('cloud host started', { port: host.port });
    process.once('SIGTERM', stopOnSignal(host, exit));
  } catch (err) {
    log.error(err, 'cloud host refused to start');
    exit(1);
  }
};

const at = process.argv.indexOf('--check');
if (at === -1) await start();
else exit(await runCheck(process.argv[at + 1]));
