import { accessOfSecurity, strongest, type Access } from './token-check.js';

type Operations = Record<string, { security?: unknown } | undefined>;

const PARAM = /^\{.+\}$/;

// As Express routes: without case, and one trailing slash ignored.
export const sameShape = (template: string, path: string): boolean => {
  const want = template.toLowerCase().split('/');
  const got = path
    .toLowerCase()
    .replace(/(.)\/$/, '$1')
    .split('/');
  return want.length === got.length && want.every((seg, i) => PARAM.test(seg) || seg === got[i]);
};

// Express runs a GET handler for a HEAD request, so a HEAD needs the access of its GET too.
export const methodsOf = (method: string): string[] => {
  const lower = method.toLowerCase();
  return lower === 'head' ? ['head', 'get'] : [lower];
};

// The strongest access any matching operation declares: Express may run another path's handler.
export const routeAccess = (
  doc: Record<string, unknown> | null | undefined,
  method: string,
  path: string
): Access => {
  const paths = (doc?.['paths'] ?? {}) as Record<string, Operations>;
  const operations = Object.keys(paths)
    .filter((template) => sameShape(template, path))
    .flatMap((template) => methodsOf(method).flatMap((m) => paths[template]?.[m] ?? []));
  if (operations.length === 0) return 'read';
  return strongest(operations.map((op) => accessOfSecurity(op.security ?? doc?.['security'])));
};
