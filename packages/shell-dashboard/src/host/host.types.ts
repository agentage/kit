// The daemon's shell contract (S1.2 sheet, platform P3): discovery, session and the change feed.
export interface AppRow {
  title: string;
  icon?: string;
  order?: number;
  // `/app/{id}/app-<hash>.js`, immutable; a new build gives a new name.
  entry: string;
  css?: string;
}

export interface ExtensionRow {
  id: string;
  version: string;
  app?: AppRow;
}

// GET /.well-known/agentage-host.json
export interface Discovery {
  host: string;
  shell?: { package: string; version: string };
  extensions: ExtensionRow[];
}

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
}

// GET /shell/session: the user the daemon's children run as, never a token.
export interface Session {
  user: SessionUser | null;
  host: string;
  // A cloud app host signed out: its auth sign-in page, back to this page. The daemon never sends it.
  signIn?: string;
}

// GET /shell/events (SSE): `extensions` and `session` say "fetch again"; `app` names the new build.
export interface AppEvent {
  id: string;
  entry: string;
  css?: string;
}

export interface EventSourceLike {
  // 0 connecting, 1 open, 2 closed (the browser gave up).
  readonly readyState: number;
  addEventListener: (type: string, fn: (e: MessageEvent<string>) => void) => void;
  close: () => void;
}

// What the shell takes from the browser; tests pass fakes.
export interface ShellDeps {
  fetch: typeof fetch;
  events: (url: string) => EventSourceLike;
  importModule: (url: string) => Promise<{ default?: unknown }>;
}
