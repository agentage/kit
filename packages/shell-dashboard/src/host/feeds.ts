import { useCallback, useEffect, useState } from 'react';
import { openFeed } from './feed-source.js';
import type { AppEvent, Discovery, Session, ShellDeps } from './host.types.js';

const DISCOVERY_URL = '/.well-known/agentage-host.json';
const SESSION_URL = '/shell/session';
const EVENTS_URL = '/shell/events';

const getJson = async <T>(deps: ShellDeps, url: string): Promise<T | null> => {
  try {
    const res = await deps.fetch(url, { headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

const withApp = (doc: Discovery, ev: AppEvent): Discovery => ({
  ...doc,
  extensions: doc.extensions.map((x) =>
    x.id === ev.id && x.app
      ? { ...x, app: { ...x.app, entry: ev.entry, css: ev.css ?? x.app.css } }
      : x
  ),
});

const titlesOf = (d: Discovery): Record<string, string> =>
  Object.fromEntries(d.extensions.flatMap((x) => (x.app ? [[x.id, x.app.title]] : [])));

const parse = (e: MessageEvent<string>): AppEvent | null => {
  try {
    return JSON.parse(e.data) as AppEvent;
  } catch {
    return null;
  }
};

// Discovery and session, fetched once and again on each event of the daemon's change feed (K7).
export const useHostFeeds = (deps: ShellDeps) => {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Every app title seen in this page, so a removed app's open page can name it.
  const [seen, setSeen] = useState<Record<string, string>>({});
  const loadDiscovery = useCallback(
    () =>
      void getJson<Discovery>(deps, DISCOVERY_URL).then((d) => {
        if (!d) return;
        setDiscovery(d);
        setSeen((s) => ({ ...s, ...titlesOf(d) }));
      }),
    [deps]
  );
  const loadSession = useCallback(
    () =>
      void getJson<Session>(deps, SESSION_URL).then((s) =>
        setSession(s ?? { user: null, host: 'local' })
      ),
    [deps]
  );
  useEffect(() => {
    loadDiscovery();
    loadSession();
    return openFeed(deps.events, EVENTS_URL, (source) => {
      // A (re)connected feed may have missed events, e.g. across a daemon restart.
      source.addEventListener('open', () => (loadDiscovery(), loadSession()));
      source.addEventListener('extensions', loadDiscovery);
      source.addEventListener('session', loadSession);
      source.addEventListener('app', (e) => {
        const ev = parse(e);
        if (ev) setDiscovery((d) => d && withApp(d, ev));
      });
    });
  }, [deps, loadDiscovery, loadSession]);
  return { discovery, session, seen, reloadSession: loadSession };
};
