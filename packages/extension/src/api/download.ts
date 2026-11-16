import { type Readable } from 'node:stream';

// A registry symbol, so a file made by a second copy of the kit is still recognised.
const FILE = Symbol.for('agentage.extension.download');

export type DownloadBody = string | Uint8Array | Readable | ReadableStream<Uint8Array>;

export interface DownloadOptions {
  // Content-Disposition: attachment; the route's produces type when contentType is left out.
  filename?: string;
  contentType?: string;
}

export interface DownloadAnswer extends DownloadOptions {
  readonly [FILE]: true;
  body: DownloadBody;
}

// What a route that declares produces returns: bytes or a stream sent as they are, not the envelope.
export const download = (body: DownloadBody, options: DownloadOptions = {}): DownloadAnswer => ({
  [FILE]: true,
  body,
  ...options,
});

export const isDownload = (value: unknown): value is DownloadAnswer =>
  typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[FILE] === true;
