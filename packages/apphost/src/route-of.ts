import { type combineHost } from '@agentage/extension/internal';

export type Route = ReturnType<typeof combineHost>['routes'][number];
export type RoutedPart = Route['part'];
// public: only a route the installation exposes to every caller (cloud); any: also internal (daemon).
export type Policy = 'public' | 'any';

// The one function from a route table to the route of a part of an id.
export const partRoute = (
  routes: Route[],
  id: string,
  part: RoutedPart,
  policy: Policy
): Route | undefined =>
  routes.find((r) => r.id === id && r.part === part && (policy === 'any' || r.expose === 'public'));

const PART_PATH = /^\/(api|mcp|app)\/([a-z][a-z0-9-]*)(?:\/.*)?$/;
// D81: these stay with the host and the api, mcp and app routes; every other path is the site.
const RESERVED = /^\/(api|mcp|app|\.well-known|health)(\/|$)/;
const WELL_KNOWN = '/.well-known';
// The host's own documents: never sent to a site.
export const HOST_DOC = `${WELL_KNOWN}/agentage-host.json`;
export const ROUTER_DOC = `${WELL_KNOWN}/agentage-router.json`;

// A route and the path prefix the forwarded path must stay under.
export interface Hit {
  route: Route;
  under: string;
}

// D82: a pages host's own well-known names come from the container of its api part.
const siteOf = (routes: Route[], path: string): Hit | undefined => {
  const site = routes.find((r) => r.part === 'pages' && r.expose === 'public');
  if (!site || path === HOST_DOC || path === ROUTER_DOC) return undefined;
  if (path.startsWith(`${WELL_KNOWN}/`)) {
    const api = partRoute(routes, site.id, 'api', 'public');
    return { route: api ?? site, under: WELL_KNOWN };
  }
  return RESERVED.test(path) ? undefined : { route: site, under: '/' };
};

// `{ route }` of a path; `{ id, part }` of a part path with no public route now; else undefined.
export const routeOf = (
  routes: Route[],
  path: string
): Hit | { id: string; part: RoutedPart } | undefined => {
  const match = PART_PATH.exec(path);
  if (!match) return siteOf(routes, path);
  const [, part, id] = match as unknown as [string, RoutedPart, string];
  const route = partRoute(routes, id, part, 'public');
  return route ? { route, under: route.prefix } : { id, part };
};
