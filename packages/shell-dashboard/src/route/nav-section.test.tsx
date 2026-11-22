import { describe, expect, it } from 'vitest';
import { navSectionView } from './nav-section.js';

const section = {
  title: 'Memories',
  items: [
    { title: 'All', path: '' },
    { title: 'a b', path: 'a%20b', icon: 'brain' },
    { title: 'odd', path: 'odd', icon: 'no-such-icon' },
  ],
};
const iconOf = (v: ReturnType<typeof navSectionView>, i: number) =>
  (v?.items[i]?.icon as { props: { name?: string; fallback?: string } }).props;

describe('navSectionView', () => {
  it('is null without a section', () => {
    expect(navSectionView('memory', '', null)).toBeNull();
  });

  it('links the items to the app and marks the longest owner of the route current', () => {
    const v = navSectionView('memory', 'a%20b/notes', section)!;
    expect(v.title).toBe('Memories');
    expect(v.items.map((i) => [i.href, i.current])).toEqual([
      ['/memory', false],
      ['/memory/a%20b', true],
      ['/memory/odd', false],
    ]);
  });

  it('marks the root item only on the app root', () => {
    expect(navSectionView('memory', '', section)!.items.map((i) => i.current)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('gives the folder icon as the fallback for a missing or unknown name', () => {
    const v = navSectionView('memory', '', section);
    expect(iconOf(v, 0)).toMatchObject({ name: undefined, fallback: 'folder' });
    expect(iconOf(v, 1).name).toBe('brain');
  });
});
