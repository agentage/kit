#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { serveHost } from './serve-host.js';

// The daemon's child and the one container: `node .../dist/host/main.js`, settings from env.
const crash = (err: unknown) => {
  createLog({ extension: 'unknown', part: 'api' }).error(err);
  process.exit(1);
};
process.on('uncaughtException', crash);
await serveHost(process.env).catch(crash);
