import { CoreFailure, fail, reasonOfError, type CoreService } from './reason.js';

export type Fetch = typeof fetch;

// One method call: every request in it shares one deadline.
export interface Call {
  service: CoreService;
  fetch: Fetch;
  signal: AbortSignal;
}

// A core answer is small; a larger body is not read to the end.
const CAP = 1_000_000;

// Settles with the work, or rejects when the deadline fires even if the work ignores the signal.
export const bounded = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });

const textOf = async (call: Call, res: Response, url: string): Promise<string> => {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let [text, size] = ['', 0];
  for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
    size += part.value.length;
    if (size > CAP) {
      void reader?.cancel().catch(() => undefined);
      fail(call.service, 'failed', `${url} answered over ${CAP} bytes`);
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
};

const parsed = (call: Call, url: string, status: number, text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(call.service, 'not_json', `${url} answered ${status} with a body that is not JSON`);
  }
};

const sent = (call: Call, url: string): Promise<Response> =>
  bounded(
    call.fetch(url, {
      redirect: 'manual',
      signal: call.signal,
      headers: { accept: 'application/json' },
    }),
    call.signal
  ).catch((err: unknown) => {
    throw asFailure(call, url, err);
  });

const asFailure = (call: Call, url: string, err: unknown): CoreFailure =>
  new CoreFailure(reasonOfError(call.service, url, err));

// A redirect is not the core's answer (a sign-in page of a network); 404 is an answer with no body.
export const getJson = async (
  call: Call,
  url: string
): Promise<{ status: number; body: unknown }> => {
  const res = await sent(call, url);
  const { status } = res;
  if (status === 404) {
    void res.body?.cancel().catch(() => undefined);
    return { status, body: null };
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    const to = res.headers.get('location');
    fail(call.service, 'failed', `${url} answered ${status}${to ? ` to ${to}` : ''}`);
  }
  const text = await bounded(textOf(call, res, url), call.signal).catch((err: unknown) => {
    throw asFailure(call, url, err);
  });
  return { status, body: parsed(call, url, status, text) };
};
