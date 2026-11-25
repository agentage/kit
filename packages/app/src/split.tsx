import { ResizableSplit, type ResizableSplitApi } from '@agentage/components/resizable-split';
import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { useAppContext } from './context.js';

export { useResizableSplit as useSplit } from '@agentage/components/resizable-split';
export type { ResizableSplitApi as SplitApi } from '@agentage/components/resizable-split';

const NAME = /^[a-z0-9-]+$/;
const PHONE = '(max-width: 759px)';

// The stored size key; the components split names its CSS variables from it.
export const splitKey = (app: string, id: string): string => `ag.split.${app}.${id}`;

// The components encoding of a storage key in a CSS variable name (`.` -> `_2e_`).
const encode = (key: string) =>
  key.replace(/[^A-Za-z0-9-]/g, (c) => `_${(c.codePointAt(0) ?? 0).toString(16)}_`);
export const splitVar = (app: string, id: string): string => `--split-${encode(splitKey(app, id))}`;

// Runs in the page head before any module: every stored `ag.split.{app}.{id}` (size and collapsed)
// is registered by its key pattern and set as the components split variables, so the first
// paint is final. A test holds the names equal to resizableSplitVar and resizableSplitCollapsedVar.
export const SPLIT_PREPAINT = `try{var d=document.documentElement,L=localStorage,E=function(k){return k.replace(/[^A-Za-z0-9-]/g,function(c){return '_'+c.charCodeAt(0).toString(16)+'_'})};for(var i=0;i<L.length;i++){var k=L.key(i),m=/^ag\\.split\\.[a-z0-9-]+\\.[a-z0-9-]+$/.test(k),n=parseInt(L.getItem(k),10);if(m&&n>0&&n<8000)d.style.setProperty('--split-'+E(k),n+'px');if(m&&L.getItem(k+'.collapsed')==='1')d.style.setProperty('--splitc-'+E(k),'0px')}}catch(e){}`;

export interface SplitProps {
  // Unique in the app, `[a-z0-9-]`; names the stored size and `data-split`.
  id: string;
  // Sized pane px before any drag, and the clamp of a stored value.
  init: number;
  min: number;
  max: number;
  label?: string;
  // `horizontal`: the first pane is sized; `vertical`: the last (bottom) one.
  orientation?: 'horizontal' | 'vertical';
  // The sized pane can collapse (a tree toggle: `useSplit().toggle()` or `apiRef`); kept in storage.
  collapsible?: boolean;
  apiRef?: Ref<ResizableSplitApi>;
  // Below 760 px one pane shows: 0 the first, 1 the second (default); the app gives the back button.
  pane?: 0 | 1;
  children: [ReactNode, ReactNode];
}

const usePhone = (): boolean => {
  const query = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches;
  const [phone, setPhone] = useState(query);
  useEffect(() => {
    const m = window.matchMedia?.(PHONE);
    const on = () => setPhone(m.matches);
    m?.addEventListener?.('change', on);
    return () => m?.removeEventListener?.('change', on);
  }, []);
  return phone;
};

// Two panes of an app on the components ResizableSplit (px, pre-paint, collapsible).
export const Split = ({ id, pane = 1, children, ...rest }: SplitProps) => {
  const { id: app } = useAppContext();
  if (!NAME.test(id)) throw new Error(`Split id "${id}" must match [a-z0-9-]+`);
  const phone = usePhone();
  // Both panes stay mounted (the hidden one keeps its state for the back button).
  if (phone)
    return (
      <div className="split" data-split={id} data-phone={pane} style={{ height: '100%' }}>
        <div hidden={pane !== 0}>{children[0]}</div>
        <div hidden={pane !== 1}>{children[1]}</div>
      </div>
    );
  return (
    <ResizableSplit storageKey={splitKey(app, id)} data-split={id} className="split" {...rest}>
      {children}
    </ResizableSplit>
  );
};
