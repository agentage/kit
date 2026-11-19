import { type CliUser } from './cli-user-watch.js';
import { LOCAL_SIGN_IN } from './sign-in-page.js';

// The kind of the app host that answers: a machine (the daemon) or a cloud host (J.4.4).
export type HostKind = 'local' | 'cloud';

export interface SessionUser {
  id: string;
  email?: string;
}

// GET /shell/session on every host kind: four keys, always; a link the host has not is null.
export interface Session {
  host: { kind: HostKind };
  signIn: string | null;
  signOut: string | null;
  user: SessionUser | null;
}

// Where the signed-in user comes from: the cli user on a machine, the auth exchange on a cloud host.
export interface SignInSource {
  kind: HostKind;
  user(): SessionUser | null;
  // null: a cloud host with no issuer has no sign-in to offer.
  signIn: string | null;
  signOut: string | null;
}

export const sessionOf = (source: SignInSource): Session => {
  const user = source.user();
  return {
    host: { kind: source.kind },
    signIn: user ? null : source.signIn,
    signOut: user ? source.signOut : null,
    user,
  };
};

const textOf = (value: unknown) => (typeof value === 'string' ? value : undefined);

// K9: the user the children run as (issuer checked in cli-user.ts) and the email of its auth.json.
export const shownUserOf = ({ sub, text }: CliUser): SessionUser | null => {
  if (sub === undefined) return null;
  let shown: Record<string, unknown> = {};
  try {
    shown = (JSON.parse(text ?? '') as { user?: Record<string, unknown> }).user ?? {};
  } catch {
    // the sub alone
  }
  const email = textOf(shown['email']);
  return { id: sub, ...(email && { email }) };
};

// The daemon: the cli user; sign-in is the page that says to run agentage setup; no sign-out.
export const cliUserSource = (user: CliUser): SignInSource => ({
  kind: 'local',
  user: () => shownUserOf(user),
  signIn: LOCAL_SIGN_IN,
  signOut: null,
});
