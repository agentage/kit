import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allPartsPackage } from '../test-support/hosted-fixture.js';
import { AUDIENCE, startIssuer, type TestIssuer } from '../test-support/issuer.js';
import { tempDir } from '../test-support/packages.js';
import { serveHost, type ServedHost } from './serve-host.js';

let issuer: TestIssuer;
const served: ServedHost[] = [];
beforeEach(async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  issuer = await startIssuer();
});
afterEach(async () => {
  for (const s of served.splice(0)) (s.server.close(), await s.host.stop());
  await issuer.close();
  vi.restoreAllMocks();
});

const MCP = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const CALL = { name: 'all__echo', arguments: { msg: 'hi' } };

const call = (port: number, authorization: string) =>
  fetch(`http://127.0.0.1:${port}/mcp/all`, {
    method: 'POST',
    headers: { ...MCP, authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: CALL }),
  });

describe('the host with an issuer set checks the tool scope', () => {
  it('a token without all:read gets 403 on tools/call; one with it gets 200', async () => {
    const secrets = await tempDir('agentage-host-auth-');
    await writeFile(join(secrets, 'tick-key'), 'k');
    const env = {
      PORT: '0',
      AGENTAGE_EXTENSION_DIR: await allPartsPackage(),
      AGENTAGE_SECRETS_DIR: secrets,
      AGENTAGE_HOST_BIND: 'all',
      AGENTAGE_ISSUER: issuer.url,
      AGENTAGE_AUDIENCE: AUDIENCE,
      AGENTAGE_ORIGIN: 'http://all.next.agentage.io',
    };
    const s = await serveHost(env, { exit: vi.fn(), ready: vi.fn(), signals: [] });
    served.push(s);
    const { port } = s.server.address() as { port: number };
    const wrong = await call(port, await issuer.bearer({ scope: 'memory:read' }));
    expect(wrong.status).toBe(403);
    expect((await call(port, await issuer.bearer({ scope: 'all:read' }))).status).toBe(200);
  });
});
