import type { NavSection } from '@agentage/app';
import type { NavSectionView } from '../frame/frame.types.js';
import { AppIcon } from './app-icon.js';
import { pageItems } from './page-items.js';

// The open app's nav section as rows; the current item follows the same rule as the title menu.
export const navSectionView = (
  id: string,
  page: string,
  section: NavSection | null
): NavSectionView | null => {
  if (!section) return null;
  const links = pageItems(id, page, section.items);
  return {
    title: section.title,
    items: links.map((l, i) => ({
      ...l,
      icon: <AppIcon name={section.items[i]?.icon} fallback="folder" />,
    })),
  };
};
