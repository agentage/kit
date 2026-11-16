#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { startHostClock } from './clock-rate.js';
import { migrateHost } from './host-migrations.js';
import { serveHost } from './serve-host.js';

// The daemon's child and the one container, settings from env; `main.js migrate`: the estate's job.
const crash = (err: unknown) => {
  createLog({ extension: 'unknown', part: 'api' }).error(err);
  process.exit(1);
};
process.on('uncaughtException', crash);
if (process.argv[2] === 'migrate') {
  await migrateHost(process.env).then(() => process.exit(0), crash);
} else {
  startHostClock(process.env);
  await serveHost(process.env).catch(crash);
}
