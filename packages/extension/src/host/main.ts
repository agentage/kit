#!/usr/bin/env node
import { createLog } from '../log/log.js';
import { serveHost } from './serve-host.js';

// The daemon's child and the one container: `node .../dist/host/main.js`, settings from env.
try {
  await serveHost(process.env);
} catch (err) {
  createLog({ extension: 'unknown', part: 'api' }).error(err);
  process.exit(1);
}
