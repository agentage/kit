#!/usr/bin/env node
import { cloudLog, startCloudHost } from './cloud-host.js';

// The cloud entry (bin agentage-apphost-cloud): the only way the program listens on 0.0.0.0.
const log = cloudLog(process.env['VERSION'] ?? '0.0.0');
try {
  const host = await startCloudHost(process.env, { log });
  log.info('cloud host started', { port: host.port });
  process.once('SIGTERM', () => void host.stop().then(() => process.exit(0)));
} catch (err) {
  log.error(err, 'cloud host refused to start');
  process.exit(1);
}
