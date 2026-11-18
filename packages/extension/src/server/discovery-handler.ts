import { type Request, type RequestHandler } from 'express';
import {
  discoveryDocument,
  recordOf,
  servingOf,
  type PartImages,
} from '../discovery/discovery.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { type PartAppBase } from './app.js';

const requestOrigin = (req: Request): string => `${req.protocol}://${req.get('host') ?? ''}`;

// GET /.well-known/agentage-extension.json: the record, the host and what this container serves.
export const discoveryHandler = (options: PartAppBase & { part: ImagePartKind }): RequestHandler => {
  const images: PartImages = options.ownImage ? { [options.part]: options.ownImage } : {};
  const record = options.record ?? recordOf(options.pkg, options.build, images);
  const serving = servingOf(options.parts ?? [options.part], options.app);
  return (req, res) => {
    res.json(discoveryDocument(record, options.origin ?? requestOrigin(req), serving));
  };
};
