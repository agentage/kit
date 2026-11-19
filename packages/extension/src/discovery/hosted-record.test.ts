import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { DIGEST, SHA, SPEC_MANIFEST } from '../test-support/packages.js';
import { discoveryDocument, hostedRecordOf } from './discovery.js';
import {
  CloudDiscoveryDocumentSchema,
  DiscoveryDocumentSchema,
  ExtensionRecordSchema,
} from './discovery.schema.js';

const BUILD = { commit: SHA, buildTime: '2026-11-16T10:00:00Z' };
const HOST = 'http://127.0.0.1:4243';
const PKG = validateManifest(SPEC_MANIFEST);
const API = { serves: ['api' as const] };
const valid = (doc: object) => DiscoveryDocumentSchema.safeParse(doc).success;

describe('the kit host record', () => {
  it('lists the parts it runs with no image, and never pages or ui', () => {
    const record = hostedRecordOf(PKG, BUILD, ['api', 'mcp', 'worker'], { migrations: 2 });
    expect(record.parts).toEqual({
      api: {},
      mcp: {},
      worker: {},
      store: { kind: 'postgres', migrations: 2 },
    });
    expect(valid(discoveryDocument(record, HOST, { serves: ['api', 'mcp', 'worker'] }))).toBe(true);
  });

  it('is a discovery form only: the build record schema still refuses it', () => {
    const record = hostedRecordOf(PKG, BUILD, ['api'], {});
    expect(ExtensionRecordSchema.safeParse(record).success).toBe(false);
  });

  it('refuses a store alone, a bare part beside an image, and a bare part with the one image', () => {
    const doc = discoveryDocument(hostedRecordOf(PKG, BUILD, ['api'], {}), HOST, API);
    expect(valid({ ...doc, parts: { store: { kind: 'postgres' } } })).toBe(false);
    const image = `ghcr.io/agentage/probe-mcp@${DIGEST}`;
    expect(valid({ ...doc, parts: { api: {}, mcp: { image } } })).toBe(false);
    expect(valid({ ...doc, image: `ghcr.io/agentage/probe@${DIGEST}` })).toBe(false);
    expect(valid({ ...doc, parts: { pages: {}, api: {} } })).toBe(false);
  });

  it('the cloud form refuses a part with no image; it takes a part by its image', () => {
    const doc = discoveryDocument(hostedRecordOf(PKG, BUILD, ['api'], {}), HOST, API);
    expect(CloudDiscoveryDocumentSchema.safeParse(doc).success).toBe(false);
    const api = { image: `ghcr.io/agentage/probe-api@${DIGEST}` };
    const cloud = { ...doc, parts: { api, mcp: {} } };
    expect(CloudDiscoveryDocumentSchema.safeParse(cloud).success).toBe(false);
    expect(CloudDiscoveryDocumentSchema.safeParse({ ...doc, parts: { api } }).success).toBe(true);
  });
});
