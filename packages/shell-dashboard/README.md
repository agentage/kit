# @agentage/shell-dashboard

The dashboard shell: one static folder that a host serves at `/`. It is the frame of the accepted
prototype (`shell-samples/index.html`, variant B) in React 19, styled by Tailwind v4 with the
`@agentage/design-system` token files (no `base.css`) and the prototype CSS as a `components` layer.

This workspace is private: it is not on npm. The root build copies `dist/` into the kit at
`dist/shell` (`scripts/inline-shell.mjs`), and the daemon serves the kit's own copy.

## Bundle output

`npm run build` writes `dist/`:

| Path                              | Served at              | What                                                                                  |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `dist/index.html`                 | `/` and every app page | pre-paint scripts, the import map, `<meta name="agentage-shell" content="<version>">` |
| `dist/shell.js`, `dist/shell.css` | `/shell/*`             | the frame                                                                             |
| `dist/vendor/*.js`                | `/shell/vendor/*`      | one React, react-dom and `@agentage/extension/app` for the shell and every app        |

The host serves `dist/*` at `/shell/*` (one mapping, `shellFileOf` in `scripts/build.mjs`). A host finds the folder with `import.meta.resolve('@agentage/shell-dashboard/dist/index.html')`.

## Regions

`data-region` names from the prototype: `mobile-header`, `nav`, `notices`, `account`, `main`,
`actions`, `bottom`, `side`, `aside`. Apps reach `actions`, `aside`, `notices`,
`bottom` and `side` through `Region` of `@agentage/extension/app`.

## Rules the code enforces

- Tokens: one `@theme` block (`@agentage/app/theme.css`, imported by `src/styles/shell.css`) puts the prototype hex values under the
  design-system names (`--color-background`, `--color-card`, `--color-accent` = hover surface,
  `--color-primary` = amber). `frame.css` reads only those names.
- No layout shift: the pre-paint script in `index.html` sets `--nav-full`, `--aside-w`, `--bot-h`
  and the `nh` (nav hidden) and `bo` (bottom open) classes from `localStorage` (`ag.nav`,
  `ag.aside`, `ag.bot`, `ag.navh`, `ag.bot.open`) before any module; `SPLIT_PREPAINT` of
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
| `src/notices/*`          | `notify()` adds a toast (role `status`) for 5 s; the inbox row in `notices` counts them; `?inbox=1` lists them in the aside, alone                                                                                       |
| `src/host/local-host.ts` | the local adapter: `/api/{id}{path}`, no token, scopes `{id}:read`, `{id}:write`, `{id}:admin`                                                                                                                           |

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
