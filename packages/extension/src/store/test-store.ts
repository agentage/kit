import { createPgliteStore, type PgliteStore } from './pglite-store.js';
import { type Store } from './store.types.js';

export type TestStore = PgliteStore;

// A throwaway in-memory store of the same kind, prepared once on first use.
export const createTestStore = (prepare: (store: Store) => Promise<unknown>): TestStore =>
  createPgliteStore(prepare);
