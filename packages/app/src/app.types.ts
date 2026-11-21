// The contract between an app and the shell that mounts it; the shell fills it, the app reads it.
// `lead` is the left of the actions bar (back, tree toggle, breadcrumb); `actions` the right group.
export type RegionName = 'lead' | 'actions' | 'aside' | 'notices' | 'bottom' | 'side';

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
  // The app's pages: the actions bar title becomes a menu of them ("Overview ⌄") and the nav lists them under the app row.
  setPages: (pages: PageLink[]) => void;
  // The bottom bar: the app gives its title and count; null hides the bottom region.
  setBottomBar: (bar: BottomBar | null) => void;
}

// One page of an app: `path` is relative to `/{id}/` ('' is the app root).
export interface PageLink {
  title: string;
  path: string;
}

export interface BottomBar {
  title: string;
  count?: number;
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

// C7: where the app runs; `url` is the host's origin.
export type HostKind = 'cloud' | 'local' | 'desktop';

export interface HostInfo {
  kind: HostKind;
  url: string;
}

export interface ExtensionInfo {
  id: string;
  version: string;
}

// One per host kind: local (the daemon), desktop and cloud. `path` is already checked.
export interface HostAdapter {
  kind: HostKind;
  url: string;
  // The version of the extension this adapter is bound to.
  version: string;
  user: AppUser | null;
  scopes: string[];
  request: (id: string, path: string, init: RequestInit) => Promise<Response>;
}

export interface AppHost {
  id: string;
  extension: ExtensionInfo;
  host: HostInfo;
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
