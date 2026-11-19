import { type RequestHandler } from 'express';

// The shell's Sign in link on the daemon: one fixed same-origin path, never a URL of another origin.
export const LOCAL_SIGN_IN = '/shell/sign-in';

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in - agentage</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 15vh auto; padding: 0 16px; }
  code { font-size: 14px; padding: 2px 6px; border-radius: 4px; background: rgba(127, 127, 127, 0.18); }
</style>
<h1>Sign in</h1>
<p>This dashboard runs on your machine. To sign in, run <code>agentage setup</code> in a terminal.</p>
<p>The dashboard shows your account a few seconds after the sign-in.</p>
<p><a href="/">Back to the dashboard</a></p>
</html>
`;

// A browser cannot start the cli: the page says how to sign in. The desktop catches the link first.
export const signInPage: RequestHandler = (_req, res) => {
  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    })
    .send(PAGE);
};
