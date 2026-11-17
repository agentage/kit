import { hostname } from 'node:os';
import { EventSchema, type Event, type EventInput, type Level } from './event.schema.js';
import { redact, scrub } from './redact.js';
import { uuidv7 } from './uuidv7.js';

const MAX_BATCH_BYTES = 900_000;
export const MAX_BATCH_ITEMS = 1000;

export interface EventsClientOptions {
  url: string;
  token: string;
  host?: string;
  timeoutMs?: number;
  // The wait before the one retry of a network error, 429 or 5xx.
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

// What a reporter posts: ts, level, agcid and host are filled when left out.
export type PostEvent = Omit<EventInput, 'ts' | 'level'> & { ts?: string; level?: Level };

export interface PostResult {
  accepted: number;
  rejected: number;
}

// A row the schema refuses is dropped with a warning and counted as rejected; the rest still go.
const complete = (event: PostEvent, host: string): Event | null => {
  const filled = { ts: new Date().toISOString(), level: 'info', agcid: uuidv7(), host, ...event };
  const msg = typeof event.msg === 'string' ? scrub(event.msg) : event.msg;
  const parsed = EventSchema.safeParse({ ...filled, msg, fields: redact(event.fields ?? {}) });
  if (parsed.success) return parsed.data;
  process.emitWarning(
    `@agentage/logs: dropped an invalid row (${parsed.error.issues[0]?.path.join('.')})`
  );
  return null;
};

const sizeOf = (event: Event): number => Buffer.byteLength(JSON.stringify(event)) + 1;

// A row alone over the batch limit would be a 413: it is dropped with a warning instead.
const fitting = (event: Event | null): event is Event => {
  if (event === null) return false;
  if (sizeOf(event) + 2 <= MAX_BATCH_BYTES) return true;
  process.emitWarning(`@agentage/logs: dropped a ${event.kind} row over 900 KB`);
  return false;
};

// Each batch under 1 MB and at most 1000 rows (the ingest wire).
export const batchesOf = (events: Event[]): Event[][] => {
  const batches: Event[][] = [];
  let batch: Event[] = [];
  let bytes = 2;
  for (const event of events) {
    const size = sizeOf(event);
    if (batch.length > 0 && (bytes + size > MAX_BATCH_BYTES || batch.length >= MAX_BATCH_ITEMS)) {
      batches.push(batch);
      [batch, bytes] = [[], 2];
    }
    batch.push(event);
    bytes += size;
  }
  return batch.length > 0 ? [...batches, batch] : batches;
};

const ONE_IMAGE = '/api/logs/events';
const LEGACY = '/api/v1/events';

// The path that answered, per url: a logs host on the one image has no /api/v1/events (404), v13 has no /api/logs/events.
const paths = new Map<string, string>();

class IngestError extends Error {
  constructor(
    readonly status: number,
    path = LEGACY
  ) {
    super(`POST ${path} answered ${status}`);
  }
}

// A network error, 429 or 5xx is tried once more; a 4xx would fail the same way again.
const retries = (err: unknown): boolean =>
  !(err instanceof IngestError) || err.status === 429 || err.status >= 500;

const request = (o: EventsClientOptions, body: string, path: string) =>
  (o.fetch ?? fetch)(`${o.url.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
  });

const sendOnce = async (o: EventsClientOptions, body: string): Promise<PostResult> => {
  const key = o.url.replace(/\/+$/, '');
  let path = paths.get(key) ?? ONE_IMAGE;
  let res = await request(o, body, path);
  if (res.status === 404 && path === ONE_IMAGE) {
    path = LEGACY;
    res = await request(o, body, path);
  }
  if (res.status !== 404 || path === LEGACY) paths.set(key, path);
  if (!res.ok) throw new IngestError(res.status, path);
  // A 2xx was taken: an unreadable answer is never retried, it would post the rows twice.
  const reply = (await res.json().catch(() => ({}))) as { data?: PostResult };
  return reply.data ?? { accepted: 0, rejected: 0 };
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const send = (o: EventsClientOptions, body: string): Promise<PostResult> =>
  sendOnce(o, body).catch(async (err: unknown) => {
    if (!retries(err)) throw err;
    await pause(o.retryDelayMs ?? 1000);
    return sendOnce(o, body);
  });

const post = async (o: EventsClientOptions, events: PostEvent[]): Promise<PostResult> => {
  if (!o.url || !o.token)
    throw new Error('@agentage/logs: the events client needs a url and a token');
  const host = o.host ?? hostname();
  const rows = events.map((event) => complete(event, host)).filter(fitting);
  const total: PostResult = { accepted: 0, rejected: events.length - rows.length };
  for (const batch of batchesOf(rows)) {
    const result = await send(o, JSON.stringify(batch));
    total.accepted += result.accepted;
    total.rejected += result.rejected;
  }
  return total;
};

// Posts rows to the ingest; a refused or unreachable ingest rejects: the caller catches.
export const createEventsClient = (o: EventsClientOptions) => ({
  post: (events: PostEvent[]): Promise<PostResult> => post(o, events),
});
