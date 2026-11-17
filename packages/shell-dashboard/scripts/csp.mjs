// The page carries its own Content-Security-Policy, so every host that serves it (daemon, router) applies it.
import { createHash } from 'node:crypto';

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

// The sha256 source of each inline script (pre-paint, split pre-paint, import map), as the browser hashes it.
export const inlineScriptHashes = (html) =>
  [...html.matchAll(INLINE_SCRIPT)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`
  );

export const policyFor = (html) =>
  [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(html).join(' ')}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

// Fills %CSP% last, after every inline script has its final text.
export const withCsp = (html) => html.replace('%CSP%', policyFor(html));
