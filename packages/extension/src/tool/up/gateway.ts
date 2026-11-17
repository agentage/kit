import { type ImagePartKind } from '../../manifest/primitives.schema.js';

export const GATEWAY_PORT = 4280;
export const ISSUER_PORT = 4281;
export const PART_PORT = 3000;
export const TRAEFIK_IMAGE =
  'traefik:v3.7.17@sha256:68ae5fe5b64ca166704b746a9e8afcd385e36b3f569a5691401bf652d57b3748';

// The URL layout of api-standards section 1, as the estate's gateway renders it.
const RESERVED =
  'PathPrefix(`/api/`) || Path(`/mcp`) || PathPrefix(`/mcp/`) || PathPrefix(`/ui/`) || PathPrefix(`/.well-known/`) || PathPrefix(`/git/`) || PathPrefix(`/files/`) || PathPrefix(`/connector`) || Path(`/health`)';

// Each routed part's path, in the order `up` prints them; /mcp is exact, the rest are prefixes.
export const PART_PATHS = { pages: '/', ui: '/ui/{version}/', api: '/api/{id}/', mcp: '/mcp' };

type RoutedPart = keyof typeof PART_PATHS;

// In this order, so the first present serves /.well-known/ (api-standards section 1).
const ROUTED: readonly RoutedPart[] = ['api', 'mcp', 'pages', 'ui'];

export interface PathOf {
  id: string;
  version: string;
}

export const partPath = (part: RoutedPart, { id, version }: PathOf): string =>
  PART_PATHS[part].replace('{version}', version).replace('{id}', id);

// mcp: bare /mcp, and /mcp/{id}, /connector/{id} and their RFC 9728 documents as the app host routes them.
const mcpRule = ({ id }: PathOf): string =>
  [
    'Path(`/mcp`)',
    `Path(\`/mcp/${id}\`)`,
    'Path(`/connector`)',
    `Path(\`/connector/${id}\`)`,
    `PathRegexp(\`^/\\.well-known/oauth-protected-resource/(mcp|connector)(/${id})?$\`)`,
  ].join(' || ');

const ruleOf = (part: RoutedPart, of: PathOf): string =>
  part === 'mcp' ? mcpRule(of) : `PathPrefix(\`${partPath(part, of)}\`)`;

// mcp above well-known (api): it serves its own RFC 9728 documents.
const PRIORITY: Partial<Record<RoutedPart, number>> = { pages: 1, mcp: 110 };

const router = (rule: string, priority: number, service: string) => ({
  rule,
  priority,
  service,
  entryPoints: ['web'],
  middlewares: ['gateway-headers'],
});

const partRouters = (routed: RoutedPart[], of: PathOf) => {
  const routers: Record<string, ReturnType<typeof router>> = {};
  for (const part of routed) routers[part] = router(ruleOf(part, of), PRIORITY[part] ?? 100, part);
  // The old api prefix, as runPart serves it, until phase 4.
  if (routed.includes('api')) routers['api-v1'] = router('PathPrefix(`/api/v1/`)', 100, 'api');
  // ctx.files (git smart-HTTP) is on the api part.
  if (routed.includes('api'))
    routers['files'] = router(`PathPrefix(\`/files/${of.id}/\`)`, 100, 'api');
  if (routed[0]) routers['well-known'] = router('PathPrefix(`/.well-known/`)', 100, routed[0]);
  return routers;
};

// Traefik's file provider: a reserved-prefix miss is Traefik's own 404, like the estate gateway.
export const gatewayConfig = (parts: ImagePartKind[], of: PathOf) => {
  const routed = ROUTED.filter((part) => parts.includes(part));
  const services: Record<string, unknown> = {
    'gateway-miss': { loadBalancer: { servers: [{ url: 'http://127.0.0.1:8081' }] } },
  };
  for (const part of routed)
    services[part] = { loadBalancer: { servers: [{ url: `http://${part}:${PART_PORT}` }] } };
  const routers: Record<string, ReturnType<typeof router>> = {
    reserved: router(RESERVED, 50, 'gateway-miss'),
    ...partRouters(routed, of),
  };
  if (!routed.includes('pages')) routers['host'] = router('PathPrefix(`/`)', 1, 'gateway-miss');
  const headers = {
    contentTypeNosniff: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
    frameDeny: true,
  };
  return { http: { middlewares: { 'gateway-headers': { headers } }, services, routers } };
};

export const TRAEFIK_COMMAND = [
  '--global.checkNewVersion=false',
  '--global.sendAnonymousUsage=false',
  '--log.format=json',
  '--providers.file.filename=/etc/traefik/dynamic.yml',
  '--entryPoints.web.address=:80',
  // No routers listen here, so every request it receives gets Traefik's own 404.
  '--entryPoints.miss.address=:8081',
  '--entryPoints.ping.address=127.0.0.1:8082',
  '--ping.entryPoint=ping',
];
