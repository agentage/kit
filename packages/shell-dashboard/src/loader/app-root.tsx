import {
  AppBoundary,
  AppContext,
  type AppContextValue,
  type AppRoute,
  type HostAdapter,
  type RegionHost,
  type ShellPort,
  type StateStore,
} from '@agentage/app';
import { useMemo, type ComponentType } from 'react';

interface Props {
  id: string;
  title: string;
  entry: string;
  App: ComponentType;
  host: HostAdapter;
  shell: ShellPort;
  route: AppRoute;
  store: StateStore;
  regions: RegionHost;
}

export const ErrorCard = ({ title, message }: { title: string; message: string }) => (
  <div role="alert" className="card-err" data-error-card={title}>
    <strong>{title} failed.</strong> {message}
  </div>
);

// A new entry remounts the root (boundary keyed by the build); the shared store keeps state(key).
export const AppRoot = ({ id, title, entry, App, host, shell, route, store, regions }: Props) => {
  const value = useMemo<AppContextValue>(
    () => ({ id, route, host, shell, store, regions }),
    [id, route, host, shell, store, regions]
  );
  return (
    <AppContext.Provider value={value}>
      <AppBoundary
        key={entry}
        name={id}
        fallback={(e) => <ErrorCard title={title} message={e.message} />}
      >
        <div className="approot" data-app={id} data-entry={entry}>
          <App />
        </div>
      </AppBoundary>
    </AppContext.Provider>
  );
};
