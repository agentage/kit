# @agentage/identity in detail

The short form is the [package README](../packages/identity/README.md).

`<authUrl>/sign-in?next=<this page>` and comes back after sign-in; call `signIn()` again on load.

- `token()` returns `() => Promise<string | undefined>`. The first call mints a one-hour PAT (`expiresInMinutes: 60`)
  (`POST /account/pat`, `format: 'jwt'`, label `browser`); it stays in page memory only and is
  minted again 60 s before it expires. Without a session it gives `undefined`.
- `signOut()` deletes that PAT (`DELETE /account/pat/{id}`; the parts refuse it within 60 s),
  then ends the auth session.
- `account()` is the signed-in account or `null`; `tokens()` lists the account's PATs.
- `mintToken({ label, scopes, expiresInDays })` mints a PAT of that label, scopes and lifetime
  (a personal token 365 days at most, default 90; an admin scope 24 hours at most; a service
  subject 90 days at most; the identity service is the source of truth and refuses a longer one)
  and resolves `{ id, token, expiresAt }`; the token is shown once.
  `revokeToken(id)` revokes one (`DELETE /account/pat/{id}`).

Two options are for tests and embedders: `fetch` (a `fetch`-shaped function; the global `fetch` is
used, read at call time, when left out) and `location` (`{ href, assign }`; `window.location` when
left out) that `signIn()` navigates.

`scopes` is required: auth mints no PAT without one. Auth sets the token's audience itself. A
failed call throws an `IdentityError` with `code`, `message` and the HTTP `status`. The client
never logs a token.
