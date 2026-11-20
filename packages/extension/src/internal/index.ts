// The kit modules the app host program (@agentage/apphost) builds on; not a public api.
export { agcidMiddleware } from '../agcid/scope.js';
export { download } from '../api/download.js';
export { type ApiContext } from '../api/routes.js';
export { fits, type Setting } from '../context/settings.js';
export {
  type Answer,
  type CallerState,
  combineHost,
  type CombineInput,
  type HostInstallation,
} from '../discovery/combine.js';
export { DiscoveryDocumentSchema } from '../discovery/discovery.schema.js';
export {
  ExposeSchema,
  HostDocumentSchema,
  type HostEntry,
  type Program,
} from '../discovery/host-document.schema.js';
export { SERVES_KINDS } from '../discovery/served.schema.js';
export { fail, ok } from '../envelope/envelope.js';
export { parse } from '../envelope/parse.js';
export { type AppRow, appRowIn, appStatic } from '../host/app-bundle.js';
export { childEnv, type LaunchSpec } from '../host/child-env.js';
export { clearOldLock, DATA_DIR_LOCKED, lockDataDir } from '../host/data-lock.js';
export { localOnly } from '../host/guard.js';
export { guardOf } from '../host/host-env.js';
export { HOST_MAIN } from '../host/host-main.js';
export { kitShellDir } from '../host/kit-shell.js';
export { serveHost } from '../host/serve-host.js';
export { createLog, type Log } from '../log/log.js';
export { type ExtensionPackage } from '../manifest/manifest.schema.js';
export { hasStore, hostParts, mountedIn, secretNames } from '../manifest/parts.js';
export {
  CommitSchema,
  ExtensionIdSchema,
  PackageNameSchema,
  SecretNameSchema,
  VersionSchema,
} from '../manifest/primitives.schema.js';
export { readManifest } from '../manifest/read-manifest.js';
export { BODY_LIMIT } from '../server/app.js';
export { errorHandler, notFound } from '../server/errors.js';
export { requestLine } from '../server/request-line.js';
export { closeNow, listen } from '../server/serve.js';
export { startOn, startTestServer, type TestServer } from '../testing/test-server.js';
export { KIT_VERSION } from '../tool/kit-version.js';
export { CLOCK_RATE_ENV, parseClockRate } from '../worker/clock.js';
