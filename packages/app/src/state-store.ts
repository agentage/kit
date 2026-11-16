import { useCallback, useSyncExternalStore } from 'react';
import type { StateStore } from './app.types.js';
import { useAppContext } from './context.js';

// One store for every app; keys are `{id}:{key}` so two apps never share a value.
export const createStateStore = (): StateStore => {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    has: (key) => values.has(key),
    get: (key) => values.get(key),
    set: (key, value) => {
      if (Object.is(values.get(key), value) && values.has(key)) return;
      values.set(key, value);
      listeners.get(key)?.forEach((listener) => listener());
    },
    subscribe: (key, listener) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => void set.delete(listener);
    },
  };
};

// `state(key)` of the sheet: kept by the shell across a remount; every reader of a key sees one value.
export const useAppState = <T>(key: string, init: T): [T, (value: T) => void] => {
  const { id, store } = useAppContext();
  const full = `${id}:${key}`;
  const subscribe = useCallback((fn: () => void) => store.subscribe(full, fn), [store, full]);
  const read = () => (store.has(full) ? (store.get(full) as T) : init);
  const value = useSyncExternalStore(subscribe, read, read);
  const set = useCallback((next: T) => store.set(full, next), [store, full]);
  return [value, set];
};
