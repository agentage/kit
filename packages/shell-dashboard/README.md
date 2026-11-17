# @agentage/shell-dashboard

The dashboard shell: one static folder that a host serves at `/`. It is the frame of the accepted
prototype (variant B; a copy is `e2e/prototype/index.html`) in React 19, styled by Tailwind v4 with the
`@agentage/design-system` token files (no `base.css`) and the prototype CSS as a `components` layer.

This workspace is private: it is not on npm. The root build copies `dist/` into the kit at
`dist/shell` (`scripts/inline-shell.mjs`), and the daemon serves the kit's own copy.

## Bundle output

`npm run build` writes `dist/`:

| Path                              | Served at              | What                                                                                      |
| --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `dist/index.html`                 | `/` and every app page | pre-paint scripts, the import map, `<meta name="agentage-shell" content="<kit version>">` |
| `dist/shell.js`, `dist/shell.css` | `/shell/*`             | the frame                                                                                 |
| `dist/vendor/*.js`                | `/shell/vendor/*`      | one React, react-dom and `@agentage/extension/app` for the shell and every app            |

The host serves `dist/*` at `/shell/*` (one mapping, `shellFileOf` in `scripts/build.mjs`). A host finds the folder with `import.meta.resolve('@agentage/shell-dashboard/dist/index.html')`.

### Content Security Policy

`dist/index.html` carries its policy in a `<meta http-equiv="Content-Security-Policy">` tag, so every host that serves the page applies it: scripts, styles, fonts, images and connections come from the page origin only (`data:` for images and fonts), with no `unsafe-inline` and no `unsafe-eval`. The build (`scripts/csp.mjs`) adds the sha256 of each inline script, so an edit to an inline script cannot make the hash stale. An app entry, an app stylesheet or a `fetch` on another origin, or an injected `<style>` element, is refused: the browser console shows a "Content Security Policy" error and the page gets a `securitypolicyviolation` event. Set styles through `style` props (React) instead. A meta policy cannot set `frame-ancestors`; the edge sends `X-Frame-Options: DENY`.

## Regions

`data-region` names from the prototype: `mobile-header`, `nav`, `notices`, `account`, `main`,
`actions`, `bottom`, `side`, `aside`. Apps reach `actions`, `aside`, `notices`,
`bottom` and `side` through `Region` of `@agentage/extension/app`.

## Nav and empty main

- No built-in nav row: the left menu holds Search and one row per installed app (`agentage.app` in
  the extension's `package.json`). The inbox is a bell button in the nav foot, beside the account
  menu (region `notices`; on a phone, the bell in `mobile-header`).
- When no extension is open, `main` shows the design-system empty state (`EmptyState`): "No
  extensions" with the install command when none is installed, else "Open an app" on `/`.
- Signed out: when `/shell/session` has `signIn` (a cloud app host; apphosts "Sign-in on the shell"),
  the account region is a "Sign in" link to it, in the same box as the account menu (no layout
  shift; on a phone, the avatar). With no `signIn` (the daemon), it keeps "Not signed in, run
  agentage setup". The shell keeps `signIn` only when it is an `https:` URL or a same-origin path
  (`/...`, never `//` or `/\`); on a loopback http page it also takes `http:`. Any other value is
  the same as no `signIn`.

## Side pane

`side` (from `frame.html`) sits left of `main`, under the actions bar: 260 px, 200 to 420, splitter
"Resize side pane", size kept in `ag.side` and set before first paint (`--side-w`). It shows only
while an app puts content in it through `Region name="side"`; the shell puts nothing there.

## Rules the code enforces

- Tokens: one `@theme` block (`@agentage/app/theme.css`, imported by `src/styles/shell.css`) puts the prototype hex values under the
  design-system names (`--color-background`, `--color-card`, `--color-accent` = hover surface,
  `--color-primary` = amber). `frame.css` reads only those names.
- No layout shift: the pre-paint script in `index.html` sets `--nav-full`, `--aside-w`, `--bot-h`
  and the `nh` (nav hidden) and `bo` (bottom open) classes from `localStorage` (`ag.nav`,
  `ag.side`, `ag.aside`, `ag.bot`, `ag.navh`, `ag.bot.open`) before any module; `SPLIT_PREPAINT` of
  `@agentage/extension/app` does the same for app splits.
- Splitters (`role="separator"`): drag, arrows 16 px, Shift 64 px, Home, End.
- `Ctrl+K` opens the command list (design-system `Command`): one line per app and "Toggle sidebar".
- Design-system components by subpath: `command`, `dropdown-menu` (account), `icon-button`, `kbd`.

## The shell at run time

| Part                     | What                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/host/feeds.ts`      | `GET /.well-known/agentage-host.json` (rows with `app`) and `GET /shell/session`, again on each `/shell/events` event: `extensions`, `session`; `app { id, entry, css }` swaps the entry of one row                      |
| `src/route/router.ts`    | `/` home, `/{id}/{page...}` an app, else "Not found"; the history API with back and forward; the aside opens with one reserved key in the query (`?details=1`, `?inspect=1`, `?inbox=1`)                                 |
| `src/loader/*`           | imports the row's hashed entry, links its css, renders the default export in `AppContext` inside an error boundary keyed by the entry: a new build remounts the root, `useAppState` values stay (one store for the page) |
| `src/notices/*`          | `notify()` adds a toast (role `status`) for 5 s; the inbox bell in the nav foot (`notices`) counts them; `?inbox=1` lists them in the aside, alone                                                                       |
| `src/host/local-host.ts` | the local adapter: `/api/{id}{path}`, no token, scopes `{id}:read`, `{id}:write`, `{id}:admin`; host `kind: local`, `url` = the page origin                                                                              |

An app that leaves the list while its page is open shows "<Title> was removed". Nav icons are a fixed
set of lucide names (`src/route/app-icon.tsx`; all of lucide would be 800 KB or 4700 chunk files); a
name outside it shows `box`.

## Tests

`npm run test:e2e -w @agentage/shell-dashboard` builds `dist-e2e/` with a fixture page (the frame
filled like the prototype) and three lab apps (`e2e/apps/`: probe, fixture with a `Split`, throws)
behind a stand-in of the daemon routes (`e2e/lab-daemon.mjs`). It serves the fixture beside a copy of
the prototype (`e2e/prototype/index.html`, a neutral account name), and checks at 1280 and 400 px: the pixel difference, axe WCAG A and AA,
CLS 0 after a reload, the keys and the phone layout; then the apps: api, notify, the aside, an error
card, not found (404), a live rebuild with state kept and no page reload, remove and add, app panes
kept across a reload. Screenshots and `diff-<width>.json` land in
`shots/`.
