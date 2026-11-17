import type { ShellDeps } from './host.types.js';

// POST the session's sign-out path; on any answer read the session again, so it shows the result.
export const signOut = (deps: ShellDeps, path: string, reload: () => void): Promise<void> =>
  deps
    .fetch(path, { method: 'POST', credentials: 'same-origin' })
    .then(
      () => undefined,
      () => undefined
    )
    .finally(reload);
