import { writeValues } from './daemon-files.js';
import { persist } from './entries.js';
import { type InstallEntry } from './installation.js';
import { type SupervisorDeps, type Values } from './supervisor.js';

// What the files of one id become; a part left out is removed.
export interface Written {
  install?: InstallEntry;
  values?: Values;
}

type Step = [run: () => Promise<unknown>, undo: () => Promise<unknown>];

const stepsOf = (deps: SupervisorDeps, id: string, to: Written, was: Written): Step[] => {
  // An empty object is no row: what valuesOf reads for an id the file does not name.
  const values = (kind: 'settings' | 'secrets', v?: Values) => () => {
    const rows = v?.[kind];
    return writeValues(
      deps.configDir,
      kind,
      id,
      rows && Object.keys(rows).length ? rows : undefined,
      deps.lockMs
    );
  };
  const steps: Step[] = [
    [() => persist(deps, id, to.install), () => persist(deps, id, was.install)],
    [values('settings', to.values), values('settings', was.values)],
    // Last: a failed write before it leaves secrets.json as it was.
    [values('secrets', to.values), values('secrets', was.values)],
  ];
  // A remove deletes the secrets first: a crash half way leaves none for a later install of id.
  return to.install ? steps : steps.reverse();
};

// An undo that failed leaves the files of id unlike the list: one warn line, and /health names it.
export const unsynced = (deps: SupervisorDeps, id: string): void => {
  deps.unsynced.add(id);
  deps.log.warn('a failed write could not be undone: the daemon files may not match the list', {
    id,
  });
};

// installation.json, settings.json, secrets.json in turn; a failed one undoes those written before it.
export const writeAll = async (
  deps: SupervisorDeps,
  id: string,
  to: Written,
  was: Written = {}
) => {
  const done: Step[1][] = [];
  try {
    for (const [run, undo] of stepsOf(deps, id, to, was)) {
      await run();
      done.unshift(undo);
    }
  } catch (err) {
    let lost = false;
    for (const undo of done) await undo().catch(() => (lost = true));
    if (lost) unsynced(deps, id);
    throw err;
  }
  deps.unsynced.delete(id);
};
