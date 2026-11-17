import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RegionName } from './app.types.js';
import { AppBoundary } from './boundary.js';
import { useAppContext } from './context.js';

// Renders children into a frame region (a portal), so the app keeps one React tree and one state.
export const Region = ({ name, children }: { name: RegionName; children: ReactNode }) => {
  const { id, regions } = useAppContext();
  const read = () => regions.node(name);
  const node = useSyncExternalStore(regions.subscribe, read, () => null);
  if (!node) return null;
  return createPortal(<AppBoundary name={`${id} ${name}`}>{children}</AppBoundary>, node);
};
