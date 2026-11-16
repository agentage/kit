import { useEffect, useState, type ComponentType } from 'react';
import type { ShellDeps } from '../host/host.types.js';

export type Loaded =
  { entry: string; App: ComponentType } | { entry: string; error: string } | null;

// Imports an app entry; the last good root stays until a new entry resolves (no empty frame).
export const useAppModule = (entry: string | undefined, deps: ShellDeps): Loaded => {
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    if (!entry) return;
    let live = true;
    deps.importModule(entry).then(
      (mod) => {
        if (!live) return;
        if (typeof mod.default === 'function')
          setLoaded({ entry, App: mod.default as ComponentType });
        else setLoaded({ entry, error: `${entry} has no default export (the app root)` });
      },
      (err: unknown) =>
        live && setLoaded({ entry, error: err instanceof Error ? err.message : String(err) })
    );
    return () => {
      live = false;
    };
  }, [entry, deps]);
  return entry ? loaded : null;
};

// One css link per open app, moved to each new build, removed when the app closes.
export const useAppCss = (id: string | undefined, href: string | undefined): void => {
  useEffect(() => {
    if (!id) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.appCss = id;
    document.head.append(link);
    return () => link.remove();
  }, [id]);
  useEffect(() => {
    if (!id || !href) return;
    const link = document.head.querySelector<HTMLLinkElement>(
      `link[data-app-css="${CSS.escape(id)}"]`
    );
    if (link && link.getAttribute('href') !== href) link.href = href;
  }, [id, href]);
};
