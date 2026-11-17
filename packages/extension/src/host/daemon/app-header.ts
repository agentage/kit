import { type RequestHandler } from 'express';
import { fail } from '../../envelope/envelope.js';

// What useAppHost().api sends: the app that made the call.
const APP_HEADER = 'x-agentage-app';

// K10: an app calls only its own extension; a raw fetch with no header is not stopped (stated limit).
export const ownAppOnly: RequestHandler = (req, _res, next) => {
  const from = req.get(APP_HEADER);
  const id = String(req.params['id']);
  if (from !== undefined && from !== id)
    throw fail('FORBIDDEN', `the app ${from} may not call the extension ${id}`);
  next();
};
