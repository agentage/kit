export { capabilities } from '../tool/capabilities.js';
export { localOnly } from './daemon/guard.js';
export { createDaemon, DAEMON_PORT, type Daemon, type DaemonOptions } from './daemon/daemon.js';
export { type Installer, type State } from './daemon/supervisor.js';
export { withFileLock } from './daemon/json-file.js';
export { updateInstallation, type InstallEntry, type Installation } from './daemon/installation.js';
export { hostExtension, type HostedExtension, type HostOptions } from './host-extension.js';
