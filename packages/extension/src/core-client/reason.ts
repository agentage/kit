// Why a call to the core gave the empty answer. It imports nothing.
export type CoreService = 'market' | 'logs';

export type CoreCode =
  'no_core' | 'unreachable' | 'timeout' | 'failed' | 'not_json' | 'refused' | 'no_token';

export interface CoreReason {
  service: CoreService;
  code: CoreCode;
  // Always `<service> not reachable`: the line a caller shows.
  message: string;
  detail: string;
  // What an address resolver threw, so a caller can keep its own error.
  cause?: unknown;
}

// down is null when the core answered; data is then the core's own answer.
export interface Answer<T> {
  data: T;
  down: CoreReason | null;
}

export const reasonOf = (
  service: CoreService,
  code: CoreCode,
  detail: string,
  cause?: unknown
): CoreReason => ({
  service,
  code,
  message: `${service} not reachable`,
  detail,
  ...(cause !== undefined && { cause }),
});

// Thrown inside the client only; the client boundary turns it into an answer.
export class CoreFailure extends Error {
  constructor(readonly reason: CoreReason) {
    super(reason.detail);
  }
}

export const fail = (service: CoreService, code: CoreCode, detail: string): never => {
  throw new CoreFailure(reasonOf(service, code, detail));
};

const nameOf = (err: unknown): unknown => (err as { name?: unknown } | null)?.name;

export const isTimeout = (err: unknown): boolean =>
  nameOf(err) === 'TimeoutError' || nameOf(err) === 'AbortError';

const textOf = (err: unknown): string => {
  const cause = (err as { cause?: { message?: unknown } } | null)?.cause?.message;
  if (typeof cause === 'string') return cause;
  return err instanceof Error ? err.message : String(err);
};

// Any throw as a reason: the client's own, a timeout, or no connection.
export const reasonOfError = (service: CoreService, what: string, err: unknown): CoreReason => {
  if (err instanceof CoreFailure) return err.reason;
  if (typeof (err as { status?: unknown } | null)?.status === 'number')
    return reasonOf(service, 'failed', `${what}: ${textOf(err)}`);
  if (isTimeout(err)) return reasonOf(service, 'timeout', `${what} did not answer in time`);
  return reasonOf(service, 'unreachable', `cannot reach ${what}: ${textOf(err)}`);
};
