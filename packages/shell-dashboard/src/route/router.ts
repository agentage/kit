import type { AppRoute, AsideKey } from '@agentage/app';
import { useEffect, useState } from 'react';

const ASIDE_KEYS: AsideKey[] = ['inspect', 'details', 'inbox'];

export interface Route {
  // The first path segment; '' on `/`.
  id: string;
  // The rest of the path after `/{id}/`.
  page: string;
  aside: AsideKey | null;
  // What the open app reads from useAppShell().route.
  app: AppRoute;
}

export const parseRoute = (pathname: string, search: string): Route => {
  const [id = '', ...rest] = pathname.replace(/^\/+/, '').split('/');
  const params = new URLSearchParams(search);
  const aside = ASIDE_KEYS.find((k) => params.get(k) === '1') ?? null;
  const page = rest.join('/');
  return {
    id: decodeURIComponent(id),
    page,
    aside,
    app: { path: page, query: Object.fromEntries(params) },
  };
};

const current = () => parseRoute(location.pathname, location.search);
const listeners = new Set<() => void>();

// The history API: push a path (`/{id}/{page}`), keep the aside key only when asked.
export const navigate = (href: string): void => {
  if (href === location.pathname + location.search) return;
  history.pushState(null, '', href);
  listeners.forEach((fn) => fn());
};

// Opens or closes the aside: one reserved key in the query, the path stays.
export const setAside = (key: AsideKey | null): void => {
  const params = new URLSearchParams(location.search);
  ASIDE_KEYS.forEach((k) => params.delete(k));
  if (key) params.set(key, '1');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
  listeners.forEach((fn) => fn());
};

export const useRoute = (): Route => {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const sync = () => setRoute(current());
    listeners.add(sync);
    window.addEventListener('popstate', sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  return route;
};
