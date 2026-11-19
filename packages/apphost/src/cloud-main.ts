#!/usr/bin/env node
import { stopOnSignal } from './cloud-drain.js';
import { cloudLog, startCloudHost } from './cloud-host.js';

// The cloud entry (bin agentage-apphost-cloud): the only way the program listens on 0.0.0.0.
const log = cloudLog(process.env['VERSION'] ?? '0.0.0');
const exit = (code: number) => process.exit(code);
try {
  const host = await startCloudHost(process.env, { log });
  log.info('cloud host started', { port: host.port });
  process.once('SIGTERM', stopOnSignal(host, exit));
} catch (err) {
  log.error(err, 'cloud host refused to start');
  exit(1);
}
