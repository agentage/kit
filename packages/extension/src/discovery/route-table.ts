import { type DiscoveryDocument } from './discovery.schema.js';
import { type Expose, type HostEntry } from './host-document.schema.js';

// The parts a host routes by path; worker and ui are never routed, pages own the rest of the paths.
const ROUTED = ['api', 'mcp', 'app', 'pages'] as const;

export type RoutedPart = (typeof ROUTED)[number];

export interface Route {
  prefix: string;
  id: string;
  part: RoutedPart;
  upstream: string;
  expose: 'public' | 'internal';
}

// One container that answered for an entry: its address and its valid document.
export interface Served {
  upstream: string;
  doc: DiscoveryDocument;
}

const prefixOf = (part: RoutedPart, id: string) => (part === 'pages' ? '/' : `/${part}/${id}`);

// A running entry's part routes to the first container that serves it, when the installation exposes it.
const routesOf = (entry: HostEntry, served: Served[]): Route[] =>
  ROUTED.flatMap((part) => {
    if (entry.state !== 'running') return [];
    const expose: Expose[RoutedPart] = entry.expose[part];
    const by = served.find(({ doc }) => doc.serves.includes(part));
    if (!expose || !by) return [];
    return [
      { prefix: prefixOf(part, entry.id), id: entry.id, part, upstream: by.upstream, expose },
    ];
  });

// In installation order; one pages route (the first row's) goes last, since / matches every path.
export const routeTable = (entries: { entry: HostEntry; served: Served[] }[]) => {
  const all = entries.flatMap(({ entry, served }) => routesOf(entry, served));
  const [site, ...more] = all.filter((r) => r.part === 'pages');
  const routes = [...all.filter((r) => r.part !== 'pages'), ...(site ? [site] : [])];
  return { routes, dropped: more };
};
