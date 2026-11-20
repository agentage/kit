import { type RequestHandler } from 'express';
import { CallerAnswerSchema, type CallerAnswer } from '../auth/caller.schema.js';
import { scopeOf, setCaller, VERBS, type Caller, type TokenCheck } from '../auth/token-check.js';
import { fail, ok } from '../envelope/envelope.js';

// Only the {id}:{verb} scopes the token holds: never another extension's, never an implied verb.
export const callerAnswer = (id: string, caller: Caller): CallerAnswer =>
  CallerAnswerSchema.parse({
    sub: caller.sub,
    scopes: VERBS.map((verb) => scopeOf(id, verb)).filter((s) => caller.scopes.includes(s)),
  });

// GET /api/{id}/caller at read: admin and write imply read, so they pass too.
export const callerHandler =
  (id: string, tokenCheck: TokenCheck): RequestHandler =>
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const caller = await tokenCheck(req.get('authorization'), 'read');
    if (!caller) throw fail('UNAUTHORIZED', 'Missing token');
    setCaller(req, caller);
    res.json(ok(callerAnswer(id, caller)));
  };
