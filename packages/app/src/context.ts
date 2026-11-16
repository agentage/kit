import { createContext, useContext, useMemo } from 'react';
import { callApi } from './api.js';
import type { AppContextValue, AppHost, AppShell } from './app.types.js';

export const AppContext = createContext<AppContextValue | null>(null);

export const useAppContext = (): AppContextValue => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('@agentage/app: a hook ran outside the shell (no AppContext)');
  return ctx;
};

export const useAppShell = (): AppShell => {
  const { id, route, shell } = useAppContext();
  return useMemo(() => ({ id, route, ...shell }), [id, route, shell]);
};

export const useAppHost = (): AppHost => {
  const { id, host } = useAppContext();
  return useMemo(
    () => ({
      id,
      user: host.user,
      scopes: host.scopes,
      api: <T>(path: string, init?: RequestInit) => callApi<T>(host, id, path, init),
    }),
    [id, host]
  );
};
