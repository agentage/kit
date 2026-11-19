import express from 'express';
import { describe, expect, it } from 'vitest';
import { createLog, errorHandler, startOn } from '@agentage/extension/internal';
import { carriesHostToken, newHostToken, NO_TOKEN, requireHostToken } from './host-token.js';

const guarded = (token: string) => {
  const app = express().use(requireHostToken(token));
  app.get('/host/x', (_req, res) => void res.json({ success: true }));
  app.use(errorHandler(createLog({ extension: 'host', part: 'api' }, () => undefined)));
  return startOn(app);
};

describe('the host token (D11)', () => {
  it('is new at each call, 43 url-safe characters', () => {
    const [a, b] = [newHostToken(), newHostToken()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('401 with none, 403 with another (also of another length), 200 with it', async () => {
    const token = newHostToken();
    const server = await guarded(token);
    const as = (authorization?: string) =>
      server.fetch('/host/x', authorization ? { headers: { authorization } } : {});
    const none = await as();
    expect([none.status, await none.json()]).toMatchObject([
      401,
      { error: { code: 'UNAUTHORIZED', message: NO_TOKEN } },
    ]);
    expect(NO_TOKEN).toBe(
      'host token required: this cli is older than the daemon, update @agentage/cli or run "agentage daemon restart"'
    );
    expect((await as('Basic abc')).status).toBe(401);
    const wrong = await as('Bearer x');
    expect([wrong.status, await wrong.json()]).toMatchObject([
      403,
      { error: { code: 'FORBIDDEN' } },
    ]);
    expect((await as(`Bearer ${token}`)).status).toBe(200);
    expect((await as(`bearer ${token}`)).status).toBe(200);
    await server.close();
  });

  it('carriesHostToken: only the exact bearer', () => {
    expect(carriesHostToken({ authorization: 'Bearer t1' }, 't1')).toBe(true);
    expect(carriesHostToken({ authorization: 'Bearer t2' }, 't1')).toBe(false);
    expect(carriesHostToken({}, 't1')).toBe(false);
  });
});
