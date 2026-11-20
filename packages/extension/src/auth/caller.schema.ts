import { z } from 'zod';

// The kit's own route under /api/{id}: an extension cannot register it.
export const CALLER_PATH = '/caller';

export const callerPath = (id: string): string => `/api/${id}${CALLER_PATH}`;

// The data of GET /api/{id}/caller: the caller's own token facts and nothing else.
export const CallerAnswerSchema = z.strictObject({
  sub: z.string().min(1),
  scopes: z.array(z.string()),
});

export type CallerAnswer = z.infer<typeof CallerAnswerSchema>;
