const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// One leading `/`, never `//` or `/\`; the origin test also catches a tab the parser drops.
const samePath = (value: string, page: URL) =>
  /^\/(?![/\\])/.test(value) && new URL(value, page).origin === page.origin;

// A same-origin path only (no URL of any scheme), else none: the session `signOut` POST target.
export const safePath = (value: unknown, origin: string): string | undefined =>
  typeof value === 'string' &&
  URL.canParse(origin) &&
  !URL.canParse(value) &&
  samePath(value, new URL(origin))
    ? value
    : undefined;

// The session `signIn` as an href: an https URL or a same-origin path, else none.
export const safeSignIn = (value: unknown, origin: string): string | undefined => {
  if (typeof value !== 'string' || !URL.canParse(origin)) return undefined;
  const page = new URL(origin);
  if (!URL.canParse(value)) return samePath(value, page) ? value : undefined;
  const { protocol } = new URL(value);
  if (protocol === 'https:') return value;
  // The lab and the local daemon serve the page on loopback http, so their auth link is http too.
  const loopback = page.protocol === 'http:' && LOOPBACK.has(page.hostname);
  return protocol === 'http:' && loopback ? value : undefined;
};
