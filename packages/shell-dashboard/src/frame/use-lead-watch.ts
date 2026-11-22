import { useEffect, type RefObject } from 'react';

// Visible content: a text or a leaf element outside any `.sr-only` box.
const seen = (node: Node): boolean => {
  if (node.nodeType === Node.TEXT_NODE) return !!node.textContent?.trim();
  if (!(node instanceof Element) || node.classList.contains('sr-only')) return false;
  return node.children.length === 0 || [...node.childNodes].some(seen);
};

// Marks the bar group `data-lead` while the app's `lead` region has visible content (the title then hides).
export const useLeadWatch = (group: RefObject<HTMLElement | null>) =>
  useEffect(() => {
    const lead = group.current?.querySelector('.lead');
    if (!group.current || !lead) return;
    const sync = () => group.current?.toggleAttribute('data-lead', [...lead.childNodes].some(seen));
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(lead, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [group]);
