// localStorage that never throws: blocked storage keeps the value for this page only.
export const readStore = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStore = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: nothing to keep.
  }
};

export const rootVarPx = (name: string, fallback: number, min: number, max: number): number => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseInt(raw, 10) || fallback;
  return Math.min(max, Math.max(min, n));
};
