import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Json = Record<string, unknown>;

// A segment the extension may use as a folder name (memory: <root>/<sub>/<vault>.git).
const SUB = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_MS = 3_000;

const objectOf = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};

const subOf = (value: unknown): string | undefined =>
  typeof value === 'string' && SUB.test(value) ? value : undefined;

const parsed = (text: string): Json => {
  try {
    return objectOf(JSON.parse(text));
  } catch {
    return {};
  }
};

// The platform token of the issuer (aga_<jwt>) names the sub, no network.
const tokenSub = (auth: Json, issuer: string): string | undefined => {
  const token = String(objectOf(objectOf(auth['platformPats'])[issuer])['token'] ?? '');
  return subOf(parsed(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())['sub']);
};

// The session as the cli checks it (get-session with its bearer); any failure is no user.
const sessionSub = async (issuer: string, bearer: unknown): Promise<string | undefined> => {
  if (typeof bearer !== 'string' || !bearer) return undefined;
  const url = `${issuer}/api/auth/mcp/get-session`;
  const headers = { authorization: `Bearer ${bearer}` };
  const signal = AbortSignal.timeout(SESSION_MS);
  const res = await fetch(url, { headers, signal, redirect: 'error' }).catch(() => undefined);
  if (!res?.ok) return void (await res?.body?.cancel());
  return subOf(objectOf(await res.json().catch(() => null))['userId']);
};

const isOrigin = (value: unknown): value is string =>
  typeof value === 'string' && URL.canParse(value) && new URL(value).origin === value;

// The user of an auth.json text: only of its own issuer; no issuer (a session before cli 0.50.1) is none.
export const cliUserOf = async (text: string): Promise<string | undefined> => {
  const auth = parsed(text);
  const issuer = auth['issuer'];
  if (!isOrigin(issuer)) return undefined;
  return tokenSub(auth, issuer) ?? sessionSub(issuer, objectOf(auth['tokens'])['accessToken']);
};

export const readCliAuth = (configDir: string): Promise<string> =>
  readFile(join(configDir, 'auth.json'), 'utf8').catch(() => '');
