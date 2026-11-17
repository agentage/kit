import type { AppRoute, RegionHost, ShellPort, StateStore } from '@agentage/app';
import { useMemo } from 'react';
import { createLocalHost } from '../host/local-host.js';
import type { ExtensionRow, SessionUser, ShellDeps } from '../host/host.types.js';
import { AppRoot, ErrorCard } from './app-root.js';
import { useAppCss, useAppModule } from './loader.js';

interface Props {
  row: ExtensionRow & { app: NonNullable<ExtensionRow['app']> };
  user: SessionUser | null;
  deps: ShellDeps;
  shell: ShellPort;
  route: AppRoute;
  store: StateStore;
  regions: RegionHost;
}

// The open app in `main`: import its entry, its css, then the root; an import error is a card.
export const AppPage = ({ row, user, deps, shell, route, store, regions }: Props) => {
  const loaded = useAppModule(row.app.entry, deps);
  useAppCss(row.id, row.app.css);
  const host = useMemo(() => createLocalHost(row.id, user, deps.fetch), [row.id, user, deps]);
  if (!loaded) return null;
  if ('error' in loaded && loaded.entry === row.app.entry)
    return <ErrorCard title={row.app.title} message={loaded.error} />;
  if (!('App' in loaded)) return null;
  return (
    <AppRoot
      id={row.id}
      title={row.app.title}
      entry={loaded.entry}
      App={loaded.App}
      host={host}
      shell={shell}
      route={route}
      store={store}
      regions={regions}
    />
  );
};
