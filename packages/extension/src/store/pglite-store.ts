import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type QueryResult, type Row, type Store } from './store.types.js';

interface PGliteLike {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  exec(text: string): Promise<{ rows: Row[] }[]>;
  close(): Promise<void>;
}

export interface PgliteStore extends Store {
  close(): Promise<void>;
}

// Where a store keeps its files (none: in memory) and a package folder that may hold PGlite.
export interface StoreAt {
  dataDir?: string;
  from?: string;
}

type PGliteModule = { PGlite: new (dataDir?: string) => PGliteLike };

export const PGLITE = '@electric-sql/pglite';

export const pgliteMissing = (tried: string[]): string =>
  `${PGLITE} is not installed (looked in ${tried.join(', then ')}): the host brings it, npm install ${PGLITE}`;

const notFound = (err: unknown): boolean =>
  ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(String((err as { code?: unknown }).code));

const fromPackage = async (from: string): Promise<PGliteModule> => {
  const file = createRequire(join(from, 'package.json')).resolve(PGLITE);
  return (await import(pathToFileURL(file).href)) as PGliteModule;
};

// The host's own copy first (the kit's resolution), then the hosted package's; only a missing one is reworded.
export const loadPglite = async (
  from?: string,
  kitCopy: () => Promise<unknown> = () => import(PGLITE)
): Promise<PGliteModule> => {
  try {
    return (await kitCopy()) as PGliteModule;
  } catch (err) {
    if (!notFound(err)) throw err;
    if (!from) throw new Error(pgliteMissing(['the kit']), { cause: err });
    return fromPackage(from).catch((again: unknown) => {
      if (!notFound(again)) throw again;
      throw new Error(pgliteMissing(['the kit', from]), { cause: again });
    });
  }
};

// Like pg: a parameterless query may hold several statements (migrations), the last one answers.
const bound = (db: PGliteLike): Store => ({
  query: async <R extends Row>(text: string, params?: unknown[]): Promise<QueryResult<R>> => {
    if (params && params.length > 0) return db.query<R>(text, params);
    const results = await db.exec(text);
    return { rows: (results.at(-1)?.rows ?? []) as R[] };
  },
});

// In-process Postgres (WASM), prepared once on first use; a failed prepare leaves no open database.
export const createPgliteStore = (
  prepare: (store: Store) => Promise<unknown>,
  at: StoreAt = {}
): PgliteStore => {
  let ready: Promise<Store & { db: PGliteLike }> | undefined;
  const start = async () => {
    const { PGlite } = await loadPglite(at.from);
    const db = new PGlite(at.dataDir);
    const store = bound(db);
    await prepare(store).catch(async (err: unknown) => {
      await db.close();
      throw err;
    });
    return { ...store, db };
  };
  return {
    query: async (text, params) => (await (ready ??= start())).query(text, params),
    close: async () => {
      if (ready) await (await ready).db.close();
    },
  };
};
