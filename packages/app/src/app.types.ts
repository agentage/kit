// The contract between an app and the shell that mounts it; the shell fills it, the app reads it.
export type RegionName = 'actions' | 'aside' | 'notices' | 'bottom' | 'side';

// The aside opens only with a reserved key; the shell puts it in the URL (`?details=1`).
export type AsideKey = 'inspect' | 'details' | 'inbox';

export type NoticeKind = 'info' | 'ok' | 'error';

export interface Notice {
  text: string;
  kind?: NoticeKind;
}

export interface AppUser {
  id: string;
  name?: string;
  email?: string;
}

// What the shell does for an app: notices, the aside and its own pages.
export interface ShellPort {
  notify: (notice: Notice) => void;
  openAside: (key: AsideKey) => void;
  closeAside: () => void;
  // A page of the app: `navigate('runs/7')` goes to `/{id}/runs/7`.
  navigate: (page: string) => void;
}

// Where the app is: `/{id}/runs/7?details=1` -> `{ path: 'runs/7', query: { details: '1' } }`.
export interface AppRoute {
  path: string;
  query: Readonly<Record<string, string>>;
}

export interface AppShell extends ShellPort {
  id: string;
  route: AppRoute;
}

// One per host kind: local (the daemon) now, cloud later. `path` is already checked.
export interface HostAdapter {
  user: AppUser | null;
  scopes: string[];
  request: (id: string, path: string, init: RequestInit) => Promise<Response>;
}

export interface AppHost {
  id: string;
  user: AppUser | null;
  scopes: string[];
  // A call to the app's own extension api: `api('/echo')` -> `/api/{id}/echo`, the envelope data.
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
}

// Values kept by the shell per app id and key, so a remount with a new module keeps them.
export interface StateStore {
  has: (key: string) => boolean;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  subscribe: (key: string, listener: () => void) => () => void;
}

// The region nodes of the frame; an app renders into them through `Region`.
export interface RegionHost {
  node: (name: RegionName) => HTMLElement | null;
  subscribe: (listener: () => void) => () => void;
}

export interface AppContextValue {
  id: string;
  route: AppRoute;
  shell: ShellPort;
  host: HostAdapter;
  store: StateStore;
  regions: RegionHost;
}
