import { Readable } from 'node:stream';
import { type ReadableStream as WebStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { type Response } from 'express';
import { type DownloadAnswer } from '../api/download.js';

const setHeaders = (res: Response, answer: DownloadAnswer, produces: string): void => {
  if (answer.filename) res.attachment(answer.filename);
  res.status(200).setHeader('Content-Type', answer.contentType ?? produces);
};

async function* from(first: IteratorResult<unknown>, rest: AsyncIterator<unknown>) {
  for (let next = first; !next.done; next = await rest.next()) yield next.value;
}

// No header goes out before the first chunk, so a failure up to it is still the error envelope.
export const sendDownload = async (res: Response, answer: DownloadAnswer, produces: string) => {
  const { body } = answer;
  if (typeof body === 'string' || body instanceof Uint8Array) {
    setHeaders(res, answer, produces);
    return void res.end(body);
  }
  const source = body instanceof Readable ? body : Readable.fromWeb(body as WebStream);
  // A client that leaves (or an answer ended) closes the source, also one waiting for its next chunk.
  res.once('close', () => source.destroy());
  const chunks = source[Symbol.asyncIterator]();
  const first = await chunks.next();
  setHeaders(res, answer, produces);
  await pipeline(Readable.from(from(first, chunks)), res);
};
