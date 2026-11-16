import { IconButton } from '@agentage/design-system/icon-button';
import type { RegionName } from '@agentage/app';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useState } from 'react';
import type { AsideState } from './frame.types.js';
import { ASIDE_SPLIT, Splitter } from './splitter.js';

interface Props {
  aside: AsideState | null;
  regionRef: (name: RegionName) => (el: HTMLElement | null) => void;
  onWide: (wide: boolean) => void;
}

// The aside region: always in the DOM (apps portal into its body), shown when `aside` is set.
export const Aside = ({ aside, regionRef, onWide }: Props) => {
  const [wide, setWide] = useState(false);
  const label = wide ? 'Shrink aside' : 'Expand aside';
  const toggle = () => {
    setWide(!wide);
    onWide(!wide);
  };
  const Icon = wide ? Minimize2 : Maximize2;
  return (
    <aside
      className="insp"
      data-region="aside"
      data-aside-key={aside?.key}
      id="aside"
      aria-label="Aside"
    >
      <Splitter {...ASIDE_SPLIT} />
      <div className="ai">
        <div className="ahead">
          <h2>{aside?.title ?? ''}</h2>
          <div className="agrp">
            <IconButton
              className="ib rounded-lg"
              icon={<Icon className="i" aria-hidden="true" />}
              aria-label={label}
              title={label}
              aria-pressed={wide}
              onClick={toggle}
            />
            <IconButton
              className="ib rounded-lg"
              icon={<X className="i" aria-hidden="true" />}
              aria-label="Close aside"
              title="Close aside"
              onClick={() => aside?.onClose()}
            />
          </div>
        </div>
        <div className="abody" ref={regionRef('aside')} />
      </div>
    </aside>
  );
};
