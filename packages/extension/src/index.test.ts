import { describe, expect, it } from 'vitest';
import * as contracts from './contracts/index.js';
import * as host from './host/index.js';
import * as kit from './index.js';
import * as logs from './logs/index.js';
import * as tool from './tool/index.js';

// Sealing: an author gets the envelope and test helpers, never the server, port or record.
describe('public surface', () => {
  it('the kit exports what an author writes against', () => {
    expect(Object.keys(kit).sort()).toEqual([
      'DiscoveryDocumentSchema',
      'ERROR_STATUS',
      'ErrorEnvelopeSchema',
      'EventSchema',
      'OkEnvelopeSchema',
      'PageQuerySchema',
      'clickhouseOf',
      'createClickhouseStore',
      'createEventsClient',
      'createTestContext',
      'download',
      'fail',
      'isClickhouseOutage',
      'ok',
      'pageOf',
      'parse',
      'parseLine',
      'reply',
      'siteFromDir',
      'startTestMcp',
      'startTestServer',
      'toolResult',
      'versionPage',
    ]);
  });

  it('the tool exports what the cli and the build call', () => {
    expect(Object.keys(tool).sort()).toEqual([
      'APP_EXTERNALS',
      'KIT_VERSION',
      'PROTOCOL_VERSIONS',
      'PackageSchema',
      'SERVED_KINDS',
      'STORE_KINDS',
      'appBuilder',
      'build',
      'buildApp',
      'buildLines',
      'canonical',
      'capabilities',
      'check',
      'checkCli',
      'checkLines',
      'down',
      'imageParts',
      'mcpSnapshot',
      'readManifest',
      'runCommand',
      'token',
      'up',
      'validateManifest',
      'writeContracts',
    ]);
  });

  it('the contracts export the wire schemas clients read', () => {
    expect(Object.keys(contracts).sort()).toEqual([
      'AGCID_HEADER',
      'CloudDiscoveryDocumentSchema',
      'DiscoveryDocumentSchema',
      'ERROR_CODES',
      'ErrorEnvelopeSchema',
      'ExtensionRecordSchema',
      'HealthSchema',
      'OkEnvelopeSchema',
      'isAgcid',
    ]);
  });

  it('the host subpath exports what the daemon and the cli call', () => {
    expect(Object.keys(host).sort()).toEqual([
      'DAEMON_PORT',
      'capabilities',
      'createDaemon',
      'hostExtension',
      'localOnly',
      'updateInstallation',
      'withFileLock',
    ]);
  });

  it('the logs subpath exports the event line', () => {
    expect(Object.keys(logs).sort()).toEqual([
      'EventSchema',
      'KINDS',
      'LEVELS',
      'USER_TYPES',
      'createEventsClient',
      'createLogger',
      'parseLine',
    ]);
  });
});
