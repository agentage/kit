import type { RegionName } from '@agentage/app';
import { useCallback, useEffect, useRef } from 'react';
import { SIDE_SPLIT, Splitter } from './splitter.js';

interface Props {
  regionRef: (name: RegionName) => (el: HTMLElement | null) => void;
}

// Set on the node, not in state: the observer runs before paint, so main never shifts (CLS 0).
const useShowWhenFilled = (toRegion: (el: HTMLElement | null) => void) => {
  const pane = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = body.current;
    if (!node || !pane.current) return;
    const check = () => pane.current && (pane.current.hidden = node.childNodes.length === 0);
    check();
    const watch = new MutationObserver(check);
    watch.observe(node, { childList: true });
    return () => watch.disconnect();
  }, []);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      body.current = el;
      toRegion(el);
    },
    [toRegion]
  );
  return { pane, ref };
};

// The `side` region of frame.html: 260 px, 200 to 420, left of main; an app fills it through Region.
export const SidePane = ({ regionRef }: Props) => {
  const { pane, ref } = useShowWhenFilled(regionRef('side'));
  return (
    <div className="sidepane" data-region="side" ref={pane} hidden>
      <div className="rc" ref={ref} />
      <Splitter {...SIDE_SPLIT} />
    </div>
  );
};
