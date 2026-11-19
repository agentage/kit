import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read } from '../test-support/combine-setup.js';
import { DiscoveryDocumentSchema, ExtensionRecordSchema } from './discovery.schema.js';
import { HostDocumentSchema, type HostDocument } from './host-document.schema.js';

const GOLDEN = join(import.meta.dirname, '..', 'test-support', 'combine', 'combined.golden.json');

const golden = async (): Promise<HostDocument> =>
  (JSON.parse(await readFile(GOLDEN, 'utf8')) as { document: HostDocument }).document;

const refused = (doc: unknown) => HostDocumentSchema.safeParse(doc).success === false;

describe('host document schema', () => {
  it('takes the combined document of the golden file', async () => {
    const doc = await golden();
    expect(HostDocumentSchema.parse(doc)).toEqual(doc);
    expect(HostDocumentSchema.parse({ host: 'local', kind: 'local', extensions: [] })).toBeTruthy();
  });

  it('refuses the shell as an extension row: the shell is a top-level key only', async () => {
    const doc = await golden();
    const row = { id: 'dashboard', version: '0.2.0', parts: [], expose: {}, state: 'running' };
    const asRow = { ...row, package: '@agentage/shell-dashboard' };
    expect(refused({ ...doc, extensions: [...doc.extensions, asRow] })).toBe(true);
    const nested = doc.extensions.map((e) => ({ ...e, shell: doc.shell }));
    expect(refused({ ...doc, extensions: nested })).toBe(true);
    expect(refused({ ...doc, shell: { ...doc.shell, title: 'agentage' } })).toBe(true);
  });

  it('refuses two entries of one id', async () => {
    const doc = await golden();
    expect(refused({ ...doc, extensions: [...doc.extensions, doc.extensions[0]] })).toBe(true);
  });

  it('refuses a document with no kind, or a kind it does not know', async () => {
    const doc = await golden();
    expect(refused({ ...doc, kind: undefined })).toBe(true);
    expect(refused({ ...doc, kind: 'desktop' })).toBe(true);
  });

  it('refuses an entry whose app, openapi or tools name another id, or an app it does not serve', async () => {
    const doc = await golden();
    const [probe] = doc.extensions;
    const bad = (entry: object) => refused({ ...doc, extensions: [{ ...probe, ...entry }] });
    expect(bad({})).toBe(false);
    expect(bad({ parts: ['api', 'mcp'] })).toBe(true);
    expect(bad({ openapi: '/api/other/openapi.json' })).toBe(true);
    expect(bad({ tools: [{ name: 'other__echo', scope: 'other:read' }] })).toBe(true);
    expect(bad({ state: 'gone' })).toBe(true);
    expect(bad({ expose: { app: 'internal' } })).toBe(true);
  });

  it('takes its tool rule from the discovery document; the build record keeps what it takes', async () => {
    const tools = [{ name: 'other__x', scope: 'public' }];
    const probe = { ...(await read('probe.json')), tools };
    expect(DiscoveryDocumentSchema.safeParse(probe).error?.issues[0]?.message).toBe(
      'every tool is {id}__{name}'
    );
    const served = new Set(['host', 'serves', 'app']);
    const record = Object.fromEntries(Object.entries(probe).filter(([key]) => !served.has(key)));
    const parts = { api: { image: `ghcr.io/agentage/probe-api@sha256:${'d'.repeat(64)}` } };
    expect(ExtensionRecordSchema.safeParse({ ...record, parts }).success).toBe(true);
  });
});
