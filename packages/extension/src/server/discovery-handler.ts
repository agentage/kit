import { type Request, type RequestHandler } from 'express';
import {
  discoveryDocument,
  recordOf,
  servingOf,
  type ServedRecord,
} from '../discovery/discovery.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { type PartAppBase } from './app.js';

const DIGEST_REF = /@sha256:[0-9a-f]{64}$/;

// With no record a part lists its image only by digest; a tag is not a release, so it lists {}.
const ownRecord = (options: PartAppBase & { part: ImagePartKind }): ServedRecord => {
  const { ownImage, part } = options;
  if (ownImage && DIGEST_REF.test(ownImage))
    return recordOf(options.pkg, options.build, { [part]: ownImage });
  const record = recordOf(options.pkg, options.build, {});
  return { ...record, parts: { [part]: {}, ...record.parts } };
};

const requestOrigin = (req: Request): string => `${req.protocol}://${req.get('host') ?? ''}`;

// GET /.well-known/agentage-extension.json: the record, the host and what this container serves.
export const discoveryHandler = (
  options: PartAppBase & { part: ImagePartKind }
): RequestHandler => {
  const record = options.record ?? ownRecord(options);
  const serving = servingOf(options.parts ?? [options.part], options.app);
  return (req, res) => {
    res.json(discoveryDocument(record, options.origin ?? requestOrigin(req), serving));
  };
};
