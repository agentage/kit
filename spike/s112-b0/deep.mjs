// Every route kind of one sealed probe child, then a wait for one worker tick; stderr scanned for denials.
// Usage: DATA_SUB=store node deep.mjs <node-binary> <probe7|probe6> [waitMs]
import { startChild } from './harness.mjs';

const [node, key, waitMs = '65000'] = process.argv.slice(2);
const c = await startChild({ node, key, sealed: true, fresh: true });
const base = `http://127.0.0.1:${c.port}`;
const v = key === 'probe7' ? '0.7.0' : '0.6.2';
const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const rpc = (method, params = {}) =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
const hit = async (label, url, init) => {
  const r = await fetch(base + url, init).catch((e) => ({ status: e.message, text: async () => '' }));
  const text = await r.text();
  console.log(JSON.stringify({ label, status: r.status, body: text.slice(0, 140) }));
};
await hit('health', '/health');
await hit('echo', '/api/probe/echo?msg=hi');
await hit('ticks', '/api/probe/ticks');
await hit('openapi', '/api/probe/openapi.json');
await hit('ui', `/ui/${v}/probe.js`);
await hit('mcp-init', '/mcp', {
  method: 'POST',
  headers: mcpHeaders,
  body: rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spike', version: '0' } }),
});
await hit('mcp-call', '/mcp', {
  method: 'POST',
  headers: mcpHeaders,
  body: rpc('tools/call', { name: 'probe__echo', arguments: { msg: 'hi' } }),
});
await new Promise((ok) => setTimeout(ok, Number(waitMs)));
await hit('ticks-after-wait', '/api/probe/ticks');
const denied = c.tail().split('\n').filter((l) => /ACCESS_DENIED|restricted|EACCES/.test(l));
console.log(JSON.stringify({ deniedLines: denied.map((l) => l.slice(0, 300)) }));
console.log(JSON.stringify({ stderrTail: c.tail().slice(-600) }));
await c.stop();
