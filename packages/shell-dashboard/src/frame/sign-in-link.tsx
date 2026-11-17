import { LogIn } from 'lucide-react';

interface Props {
  href: string;
  version: string;
  compact?: boolean;
}

// The same box as the account trigger, so the swap from pending to signed out shifts nothing.
export const SignInLink = ({ href, version, compact }: Props) =>
  compact ? (
    <a className="av" href={href} aria-label="Sign in" title="Sign in">
      <LogIn className="i" aria-hidden="true" />
    </a>
  ) : (
    <a className="acct signin" href={href} title="Sign in">
      <span className="av" aria-hidden="true">
        <LogIn className="i" />
      </span>
      <span className="who">
        <b>Sign in</b>
        <span data-shell-version={version}>kit {version}</span>
      </span>
    </a>
  );
