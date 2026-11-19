import { type Request, type Response } from 'express';
import { describe, expect, it } from 'vitest';
import { DiscoveryDocumentSchema } from '../discovery/discovery.schema.js';
import { createLog } from '../log/log.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { API_MANIFEST, DIGEST, SHA } from '../test-support/packages.js';
import { discoveryHandler } from './discovery-handler.js';

const BUILD = { commit: SHA, buildTime: '2026-11-03T20:00:00Z' };

// The document one part image serves with no record mounted and AGENTAGE_IMAGE as given.
const served = (part: ImagePartKind, ownImage?: string) => {
  const log = createLog({ extension: 'probe', part, version: '0.1.0' });
  const options = { pkg: API_MANIFEST, build: BUILD, log, part, ownImage };
  const req = { protocol: 'https', get: () => 'probe.next.agentage.io' } as unknown as Request;
  let body: unknown;
  const res = { json: (value: unknown) => (body = value) } as unknown as Response;
  void discoveryHandler(options)(req, res, () => undefined);
  return body as Record<string, unknown>;
};

describe('discovery of a part image with no record', () => {
  it.each(['pages', 'ui', 'api', 'mcp'] as const)('%s with an image by tag lists {}', (part) => {
    const doc = served(part, `ghcr.io/agentage/probe-${part}:0.1.0`);
    expect(DiscoveryDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc).toMatchObject({ parts: { [part]: {} }, serves: [part] });
  });

  it('lists the image when it is a digest, and {} with no image at all', () => {
    const image = `ghcr.io/agentage/probe-pages@${DIGEST}`;
    expect(served('pages', image)['parts']).toEqual({ pages: { image } });
    expect(DiscoveryDocumentSchema.safeParse(served('pages', image)).success).toBe(true);
    expect(served('pages')['parts']).toEqual({ pages: {} });
  });
});
