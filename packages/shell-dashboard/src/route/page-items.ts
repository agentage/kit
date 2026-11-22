import type { PageLink } from '@agentage/app';
import type { PageItem } from '../frame/frame.types.js';

const trim = (path: string) => path.replace(/^\/+|\/+$/g, '');

// A page owns the route when it equals it or is a parent folder of it; '' only on an exact match.
const owns = (path: string, page: string) =>
  path === page || (path !== '' && page.startsWith(`${path}/`));

// The open app's pages as links; the longest owning path is the current one.
export const pageItems = (id: string, page: string, pages: PageLink[]): PageItem[] => {
  const here = trim(page);
  const paths = pages.map((p) => trim(p.path));
  const best = paths.filter((p) => owns(p, here)).sort((a, b) => b.length - a.length)[0];
  return pages.map((p, i) => ({
    title: p.title,
    href: `/${id}${paths[i] && `/${paths[i]}`}`,
    current: paths[i] === best,
  }));
};
