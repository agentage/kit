import { describe, expect, it } from 'vitest';
import { pageItems } from './page-items.js';

const pages = [
  { title: 'All memories', path: '' },
  { title: 'demo', path: 'demo' },
  { title: 'Projects', path: '/demo/projects' },
];
const currentOf = (page: string) =>
  pageItems('memory', page, pages)
    .filter((p) => p.current)
    .map((p) => p.title);

describe('pageItems', () => {
  it('builds hrefs under the app id and strips leading slashes', () => {
    expect(pageItems('memory', '', pages).map((p) => p.href)).toEqual([
      '/memory',
      '/memory/demo',
      '/memory/demo/projects',
    ]);
  });

  it("'' is current only on the exact root", () => {
    expect(currentOf('')).toEqual(['All memories']);
    expect(currentOf('other')).toEqual([]);
  });

  it('a path owns itself and the routes below it', () => {
    expect(currentOf('demo')).toEqual(['demo']);
    expect(currentOf('demo/projects/agentage/')).toEqual(['Projects']);
    expect(currentOf('demonstration')).toEqual([]);
  });

  it('the longest matching path wins', () => {
    expect(currentOf('demo/projects')).toEqual(['Projects']);
    expect(currentOf('demo/notes')).toEqual(['demo']);
  });
});
