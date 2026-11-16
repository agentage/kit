import express, { type Express } from 'express';
import { ok } from '../../envelope/envelope.js';
import { BODY_LIMIT } from '../../server/app.js';
import { type Entries } from './entries.js';
import { waitAtMost } from './queue.js';
import { reloadExtension } from './reload.js';
import { stopsNow } from './stopping.js';
import { type SupervisorDeps } from './supervisor.js';

// In the change queue (a second reload waits); refused like every change while installation.json is unreadable.
export const reloadRoute = (
  app: Express,
  deps: SupervisorDeps,
  entries: Entries,
  readable: () => Promise<void>
): void => {
  app.post('/host/extensions/:id/reload', express.json({ limit: BODY_LIMIT }), async (req, res) => {
    const id = String(req.params['id']);
    const run = () =>
      waitAtMost(deps.queue, deps.installMs, async () => {
        if (deps.stopping.signal.aborted) throw stopsNow();
        await readable();
        return reloadExtension(deps, entries, id, req.body);
      });
    res.json(ok(await deps.pending.track({ op: 'reload', id }, run)));
  });
};
