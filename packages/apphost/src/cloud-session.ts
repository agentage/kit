import { type IncomingHttpHeaders } from 'node:http';
import { type RequestHandler } from 'express';
import { fail } from '@agentage/extension/internal';
import { createAddressLimit, createExchange, type Exchange } from './auth-exchange.js';
import { createIdentityRead, type IdentityRead } from './auth-identity-cache.js';
import {
  addressOf,
  type CloudRequest,
  credentialOf,
  foreignPage,
  withoutCredentials,
} from './cloud-credentials.js';
import { issuerOf } from './cloud-env.js';
import { createCloudSignOut } from './cloud-sign-out.js';
import { type Session, sessionOf, type SignInSource } from './session.js';

export const CLOUD_SIGN_OUT = '/shell/sign-out';

export interface CloudSessionOptions {
  // AGENTAGE_ISSUER; a value that is not an https origin means no sign-in on this host.
  issuer?: string | null | undefined;
  // The local run (LOCAL_FLAG): the dev issuer over http is taken too.
  local?: boolean;
  // AGENTAGE_URL: the origin of this host's own pages.
  own: string;
  fetcher?: typeof fetch;
  // false: a host with no shell key serves no /shell/sign-out, so its session names none.
  signOut?: boolean;
}

export interface CloudSession {
  // GET /shell/session: the four keys of Session, kind cloud.
  answer(req: CloudRequest): Promise<Session>;
  // The upstream headers of `id`: no auth cookie; a PAT stays; a session or a desktop bearer becomes the token.
  headersFor(req: CloudRequest, id: string): Promise<IncomingHttpHeaders>;
  signOut: RequestHandler;
}

const forgetNone = { forget: () => undefined };
const noExchange: Exchange = Object.assign(async () => null, forgetNone);
const noIdentity: IdentityRead = Object.assign(async () => null, forgetNone);
const signedOut = { exchange: noExchange, identity: noIdentity };

// One address limit for both: a miss of either read costs one of the 30 a minute.
const authOf = (issuer: string | null, fetcher?: typeof fetch) => {
  if (!issuer) return signedOut;
  const options = { issuer, allow: createAddressLimit(), ...(fetcher && { fetcher }) };
  return { exchange: createExchange(options), identity: createIdentityRead(options) };
};

const headersOf =
  (exchange: Exchange, own: string) =>
  async (req: CloudRequest, id: string): Promise<IncomingHttpHeaders> => {
    const credential = credentialOf(req);
    if (!credential) return withoutCredentials(req.headers);
    if ('cookie' in credential && foreignPage(req, own))
      throw fail('FORBIDDEN', 'not a page of this host');
    // Admin covers write: auth refuses a non-admin with 403 and write follows.
    const data = await exchange(credential, id, ['admin', 'write'], addressOf(req));
    const rest = withoutCredentials(req.headers);
    delete rest.authorization;
    // The exchanged token is an aga_ bearer: a second filter at the proxy keeps it.
    return data ? { ...rest, authorization: `Bearer ${data.token}` } : rest;
  };

interface Links {
  issuer: string | null;
  signIn: string | null;
  signOut: boolean;
}

// The user of the session needs no extension id: a host name is never one.
const answerOf =
  (identity: IdentityRead, { issuer, signIn, signOut }: Links) =>
  async (req: CloudRequest): Promise<Session> => {
    const credential = credentialOf(req);
    const user = credential && (await identity(credential, addressOf(req)));
    const source: SignInSource = {
      kind: 'cloud',
      user: () => user ?? null,
      signIn,
      // Only a cookie session can sign out here; the desktop signs out on its own.
      signOut: signOut && issuer && credential && 'cookie' in credential ? CLOUD_SIGN_OUT : null,
    };
    return sessionOf(source);
  };

// The cloud sign-in source of the session module (J.4.4): an identity read; an exchange per api id.
export const createCloudSession = (options: CloudSessionOptions): CloudSession => {
  const issuer = issuerOf(options.issuer ?? undefined, options.local ?? false);
  // The Origin header is an origin: a trailing slash in AGENTAGE_URL must not refuse every POST.
  const own = new URL(options.own).origin;
  const { exchange, identity } = authOf(issuer, options.fetcher);
  const signIn = issuer && `${issuer}/sign-in?next=${encodeURIComponent(`${own}/`)}`;
  const signOut = createCloudSignOut({
    issuer,
    own,
    forget: (credential) => {
      exchange.forget(credential);
      identity.forget(credential);
    },
    ...(options.fetcher && { fetcher: options.fetcher }),
  });
  const links = { issuer, signIn, signOut: options.signOut ?? true };
  const answer = answerOf(identity, links);
  return { answer, headersFor: headersOf(exchange, own), signOut };
};
