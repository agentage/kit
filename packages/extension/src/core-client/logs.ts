import { createEventsClient, type PostEvent, type PostResult } from '@agentage/logs';
import type { Call } from './http.js';
import { fail } from './reason.js';

export interface LogsCall extends Call {
  origin: string;
  token: string | undefined;
  timeoutMs: number;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// A bearer goes only over https, or to this machine.
const safe = (origin: string): boolean => {
  const url = new URL(origin);
  return url.protocol === 'https:' || LOOPBACK.has(url.hostname);
};

const urlOf = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : String(input);

// Every request of the events client, its retry too, stops at the call's deadline.
const deadlined =
  (call: Call): typeof fetch =>
  (input, init) =>
    call.fetch(urlOf(input), {
      ...init,
      redirect: 'manual',
      signal: init?.signal ? AbortSignal.any([init.signal, call.signal]) : call.signal,
    });

// The events client fills, redacts and batches the rows; a failed post rejects and is caught above.
export const sendTo = async (call: LogsCall, events: PostEvent[]): Promise<PostResult> => {
  if (!call.token) return fail('logs', 'no_token', 'no token for the logs ingest');
  if (!safe(call.origin))
    return fail('logs', 'refused', `${call.origin}: a token goes over https only`);
  const client = createEventsClient({
    url: call.origin,
    token: call.token,
    timeoutMs: call.timeoutMs,
    retryDelayMs: 0,
    fetch: deadlined(call),
  });
  return client.post(events);
};
