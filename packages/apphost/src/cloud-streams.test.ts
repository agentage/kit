import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeUpstreams,
  cloudEnv,
  docOf,
  OWN_HOST,
  type Rows,
  startCloud,
  type Started,
  upstream,
  type Upstream,
} from './test-support/cloud-start.js';

let host: Started | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  closeUpstreams();
});

const PAT = 'Bearer aga_0123456789abcdef0123';

// cloud: api and mcp public; apionly, mcponly: one part; shy: internal; gone: its upstream refuses.
const start = async () => {
  const cloud = await upstream(docOf('cloud', ['api', 'mcp']));
  const apionly = await upstream(docOf('apionly', ['api']));
  const mcponly = await upstream(docOf('mcponly', ['mcp']));
  const shy = await upstream(docOf('shy', ['api', 'mcp']));
  const extensions: Rows['extensions'] = [
    { id: 'cloud', expose: { api: 'public', mcp: 'public' } },
    { id: 'apionly', expose: { api: 'public' } },
    { id: 'mcponly', expose: { mcp: 'public' } },
    { id: 'shy', expose: { api: 'internal', mcp: 'internal' } },
    { id: 'gone', expose: { api: 'public' } },
  ];
  const ups = { cloud, apionly, mcponly, shy } as Record<string, Upstream>;
  const upstreams = [
    ...Object.entries(ups).map(([id, up]) => ({ id, address: up.address })),
    { id: 'gone', address: 'http://127.0.0.1:1' },
  ];
  host = await startCloud(await cloudEnv({ extensions, upstreams }));
  return { cloud, apionly, mcponly, shy, port: host.port };
};

// A POST with a body (callAt sends none): the status and what the upstream counted.
const push = (port: number, path: string, body: Buffer, headers: Record<string, string>) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const all = { host: OWN_HOST, 'content-length': String(body.length), ...headers };
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: all }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject).end(body);
  });

describe('/files/{id}/* and /connector/{id} (PD9, stub streams)', () => {
  it('a 5 MiB git push streams whole: path and query kept, Authorization kept, Cookie dropped', async () => {
    const { cloud, port } = await start();
    let size = 0;
    cloud.custom = (req, res) => {
      if (!req.url?.startsWith('/files/')) return false;
      req.on('data', (c: Buffer) => (size += c.length));
      req.on('end', () => res.end(JSON.stringify(req.headers)));
      return true;
    };
    const big = Buffer.alloc(5 * 1024 * 1024, 1);
    const path = '/files/cloud/repo.git/git-receive-pack?x=1';
    const res = await push(port, path, big, { authorization: PAT, cookie: 'sid=1' });
    const seen = JSON.parse(res.text) as Record<string, string>;
    expect([res.status, size, seen['authorization'], seen['cookie']]).toEqual([
      200,
      big.length,
      PAT,
      undefined,
    ]);
  });

  it('each to the public part it needs: /files the api part, /connector the mcp part', async () => {
    const { cloud, apionly, mcponly } = await start();
    const call = host!.call;
    expect((await call('/connector/cloud')).status).toBe(200);
    expect((await call('/files/cloud')).status).toBe(200);
    expect((await call('/files/apionly/r.git/info/refs?service=git-upload-pack')).status).toBe(200);
    expect((await call('/connector/mcponly')).status).toBe(200);
    const urls = [...cloud.seen, ...apionly.seen, ...mcponly.seen].map((s) => s.url);
    expect(urls).toEqual([
      '/connector/cloud',
      '/files/cloud',
      '/files/apionly/r.git/info/refs?service=git-upload-pack',
      '/connector/mcponly',
    ]);
  });

  it.each([
    '/files/mcponly/a',
    '/connector/apionly',
    '/files/shy/a',
    '/connector/shy',
    '/files/nosuch/a',
    '/files/Bad_Id/a',
    '/connector/nosuch',
    '/connector/cloud/x',
    '/files',
  ])('%s is 404 and reaches no upstream', async (path) => {
    const { cloud, shy } = await start();
    expect((await host!.call(path)).status).toBe(404);
    expect([...cloud.seen, ...shy.seen]).toEqual([]);
  });

  it('a public part that is not running is 503 with Retry-After', async () => {
    await start();
    const res = await host!.call('/files/gone/a');
    expect([res.status, res.headers['retry-after']]).toEqual([503, '5']);
  });

  it('dot segments resolve before routing: the path the upstream gets is the one routed', async () => {
    const { cloud, apionly } = await start();
    expect((await host!.call('/files/cloud/%2e%2e/%2e%2e/connector/cloud')).status).toBe(200);
    expect((await host!.call('/files/apionly/../../files/mcponly/a')).status).toBe(404);
    expect([...cloud.seen, ...apionly.seen].map((s) => s.url)).toEqual(['/connector/cloud']);
  });
});
