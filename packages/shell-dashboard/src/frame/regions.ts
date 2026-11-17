import type { RegionHost, RegionName } from '@agentage/app';

// The frame's region nodes; apps reach them through Region (a portal), the shell through the refs.
export const createRegionHost = (): RegionHost & {
  ref: (name: RegionName) => (el: HTMLElement | null) => void;
} => {
  const nodes = new Map<RegionName, HTMLElement>();
  const listeners = new Set<() => void>();
  const refs = new Map<RegionName, (el: HTMLElement | null) => void>();
  const ref = (name: RegionName) => {
    const known = refs.get(name);
    if (known) return known;
    const set = (el: HTMLElement | null) => {
      if (el) nodes.set(name, el);
      else nodes.delete(name);
      listeners.forEach((fn) => fn());
    };
    refs.set(name, set);
    return set;
  };
  return {
    node: (name) => nodes.get(name) ?? null,
    subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    ref,
  };
};
