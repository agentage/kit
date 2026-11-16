import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fail, reply } from '../envelope/envelope.js';
import { ErrorEnvelopeSchema } from '../envelope/envelope.schema.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { startTestServer, type TestServer } from '../testing/test-server.js';
import { generatedOpenapi } from './openapi-doc.js';
import { createRouteRegistry, type ApiContext } from './routes.js';

// Production GET /sync: the plugin reads this shape as it is, and revalidates with its ETag.
const Sync = z.object({
  git_endpoint: z.string(),
  region: z.string(),
  vaults: z.array(z.string()),
  ttl: z.number(),
});
const SYNC = {
  git_endpoint: 'https://x/files/memory/u_a',
  region: 'eu',
  vaults: ['default'],
  ttl: 300,
};
const sync = { summary: 'Sync', bare: true, etag: true, output: Sync } as const;

const create = ({ route }: ApiContext) => {
  route('get', '/sync', sync, () => reply(SYNC, { etag: '"v1"' }));
  route('get', '/plain', { summary: 'Plain', bare: true }, () => ({ a: 1 }));
  route('get', '/gone', { summary: 'Gone', bare: true }, () => {
    throw fail('NOT_FOUND', 'No vault');
  });
};

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const get = async (path: string, headers: Record<string, string> = {}) => {
  server ??= await startTestServer({ create });
  return server.fetch(`/api/test${path}`, { headers });
};

describe('a bare route', () => {
  it('answers the body as it is, no envelope, with its ETag', async () => {
    const res = await get('/sync');
    expect([res.status, res.headers.get('etag'), await res.json()]).toEqual([200, '"v1"', SYNC]);
    expect(await (await get('/plain')).json()).toEqual({ a: 1 });
  });

  it.each(['"v1"', 'W/"v1"', '"v0", "v1"', '*'])('answers 304 to If-None-Match %s', async (tag) => {
    const res = await get('/sync', { 'if-none-match': tag });
    expect([res.status, res.headers.get('etag'), await res.text()]).toEqual([304, '"v1"', '']);
  });

  it('answers 200 to a stale tag, and a failure in the error envelope', async () => {
    expect((await get('/sync', { 'if-none-match': '"v0"' })).status).toBe(200);
    const gone = await get('/gone');
    expect(gone.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await gone.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('bare in the registry and the contract', () => {
  const { route, routes } = createRouteRegistry();
  route('get', '/sync', sync, () => SYNC);

  it('refuses bare with produces', () => {
    const register = route as (...args: unknown[]) => void;
    const spec = { summary: 'S', bare: true, produces: 'application/zip' };
    expect(() => register('get', '/x', spec, () => 1)).toThrow('bare answers JSON');
  });

  it('documents the body, If-None-Match and 304, not the envelope', () => {
    const doc = generatedOpenapi(API_MANIFEST, routes) as {
      paths: Record<
        string,
        {
          get: {
            parameters: { name: string }[];
            responses: Record<
              string,
              { content?: Record<string, { schema: { properties: object } }> }
            >;
          };
        }
      >;
    };
    const op = Object.values(doc.paths)[0]?.get;
    expect(op?.parameters.map((p) => p.name)).toEqual(['If-None-Match']);
    expect(Object.keys(op?.responses ?? {}).sort()).toEqual(['200', '304', '401', '403']);
    const body = op?.responses['200']?.content?.['application/json']?.schema;
    expect(Object.keys(body?.properties ?? {})).toEqual([
      'git_endpoint',
      'region',
      'vaults',
      'ttl',
    ]);
  });
});
