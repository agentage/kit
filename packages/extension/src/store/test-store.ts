import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type QueryResult, type Row, type Store } from './store.types.js';

interface PGliteLike {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  exec(text: string): Promise<{ rows: Row[] }[]>;
  close(): Promise<void>;
}

export interface TestStore extends Store {
  close(): Promise<void>;
}

// Where a store keeps its files (none: in memory) and the package folder that may hold PGlite.
export interface StoreAt {
  dataDir?: string;
  from?: string;
}

type PGliteModule = { PGlite: new (dataDir?: string) => PGliteLike };

// The kit's own copy first; a host also finds the one the extension installed.
const load = async (from?: string): Promise<PGliteModule> => {
  try {
    return (await import('@electric-sql/pglite')) as unknown as PGliteModule;
  } catch (err) {
    if (!from) throw err;
    const file = createRequire(join(from, 'package.json')).resolve('@electric-sql/pglite');
    return (await import(pathToFileURL(file).href)) as PGliteModule;
  }
};

export const PGLITE_MISSING =
  'a postgres store here needs @electric-sql/pglite: npm install @electric-sql/pglite';

const open = async (at: StoreAt): Promise<PGliteLike> => {
  const { PGlite } = await load(at.from).catch(() => {
    throw new Error(PGLITE_MISSING);
  });
  return new PGlite(at.dataDir);
};

// Like pg: a parameterless query may hold several statements (migrations), the last one answers.
const bound = (db: PGliteLike): Store => ({
  query: async <R extends Row>(text: string, params?: unknown[]): Promise<QueryResult<R>> => {
    if (params && params.length > 0) return db.query<R>(text, params);
    const results = await db.exec(text);
    return { rows: (results.at(-1)?.rows ?? []) as R[] };
  },
});

// In-process Postgres (WASM): a throwaway store of the same kind, prepared once on first use.
export const createTestStore = (
  prepare: (store: Store) => Promise<unknown>,
  at: StoreAt = {}
): TestStore => {
  let ready: Promise<Store & { db: PGliteLike }> | undefined;
  const start = async () => {
    const db = await open(at);
    const store = bound(db);
    // A failed migration leaves no open database behind.
    await prepare(store).catch(async (err: unknown) => {
      await db.close();
      throw err;
    });
    return { ...store, db };
  };
  return {
    query: async (text, params) => {
      ready ??= start();
      return (await ready).query(text, params);
    },
    close: async () => {
      if (ready) await (await ready).db.close();
    },
  };
};
