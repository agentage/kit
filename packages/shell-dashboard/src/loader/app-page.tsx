import type { AppRoute, RegionHost, ShellPort, StateStore } from '@agentage/app';
import { useMemo } from 'react';
import { adapterFor } from '../host/host-adapter.js';
import type { ExtensionRow, Session, ShellDeps } from '../host/host.types.js';
import { AppRoot, ErrorCard } from './app-root.js';
import { useAppCss, useAppModule } from './loader.js';

interface Props {
  row: ExtensionRow & { app: NonNullable<ExtensionRow['app']> };
  session: Session;
  deps: ShellDeps;
  shell: ShellPort;
  route: AppRoute;
  store: StateStore;
  regions: RegionHost;
}

const noAdapter = (session: Session) =>
  session.host
    ? `this shell has no adapter for the host kind ${String(session.host.kind)}`
    : 'the host session could not be read';

// The open app in `main`: import its entry, its css, then the root; an import error is a card.
export const AppPage = ({ row, session, deps, shell, route, store, regions }: Props) => {
  const loaded = useAppModule(row.app.entry, deps);
  useAppCss(row.id, row.app.css);
  const { id, version } = row;
  const host = useMemo(
    () => adapterFor({ id, version }, session, deps.fetch),
    [id, version, session, deps]
  );
  if (!host) return <ErrorCard title={row.app.title} message={noAdapter(session)} />;
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
