import { DropdownMenu, DropdownMenuItem } from '@agentage/design-system/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import type { PageItem } from './frame.types.js';

interface Props {
  title: string;
  pages: PageItem[];
  onNavigate: (href: string) => void;
}

// The title of the actions bar; with pages it opens the page list ("Overview ⌄").
export const TitleMenu = ({ title, pages, onNavigate }: Props) => {
  if (!pages.length) return <span className="ttl">{title}</span>;
  return (
    <DropdownMenu
      align="start"
      trigger={
        <button className="ttl" aria-label={`${title}, pages`}>
          {title}
          <ChevronDown className="i" aria-hidden="true" />
        </button>
      }
    >
      {pages.map((p) => (
        <DropdownMenuItem
          key={p.href}
          aria-current={p.current ? 'page' : undefined}
          onClick={() => onNavigate(p.href)}
        >
          {p.title}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
};
