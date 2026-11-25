# @agentage/extension/app

This workspace (`packages/app`, private) is published only inside the kit: the kit build copies its
`dist` and `theme.css` to `dist/vendor/app` (`scripts/inline-app.mjs`). React 19 is an optional
peer of the kit. `Split` imports `@agentage/components` (^0.21.0): an app that renders it outside
the shell (tests) installs it; the shell's copy is in `vendor/app.js`. The kit lists it as an
optional peer (`^0.20`).

The one import of an agentage app. An app is one root component (the default export of
`src/app/index.tsx`); the shell mounts it in the `main` region and gives it these hooks. The app has
no code for layout, auth or storage.

The shell serves one copy of React and of this package through an import map: an app bundle keeps
`react`, `react-dom` and `@agentage/extension/app` external.

## The calls

| Call                      | What it gives                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAppShell()`           | `{ id, route: { path, query }, notify({ text, kind }), openAside(key), closeAside(), navigate(page), setPages([{ title, path }]), setBottomBar({ title, count } \| null) }`; `route.path` is the page after `/{id}/` |
| `useAppHost()`            | `{ id, extension: { id, version }, host: { kind, url }, user, scopes, api(path, init?) }` (C7; `kind` is `local`, `desktop` or `cloud`); `api('/echo')` calls `/api/{id}/echo` and returns the envelope `data`       |
| `useAppState(key, init)`  | `[value, set]`, kept by the shell per app and key: a remount (a new build, an update) keeps it; every reader of a key sees one value                                                                                 |
| `<Region name>`           | renders its children into a frame region (`lead`, `actions`, `aside`, `notices`, `bottom`, `side`) as a React portal, inside an error boundary                                                                       |
| `<Split id init min max>` | two panes on the components `ResizableSplit` (px; arrows 16 px, Shift 64 px, Home, End, drag; `orientation`, `collapsible` with `useSplit().toggle()`); the size holds across a reload with no layout shift          |
| `AppBoundary`             | the error boundary the shell puts around each app root and `Region`                                                                                                                                                  |
| `AppApiError`             | what `api` throws: `code` (the envelope code, `FORBIDDEN` for a refused path, else `HTTP_<status>`), `status`                                                                                                        |

`setPages` makes the actions bar title a menu of the pages. `setNavSection({ title, items })` adds a titled list of items (`title`, `path`, optional `icon` name) to the nav panel below the app rows while the app is open; `null` removes it. The current item is the longest `path` that equals the route or is a folder above it (`''` matches only the app root).

Keys of `openAside`: `inspect`, `details`, `inbox` (the shell puts the key in the URL, `?details=1`).

## Rules the code enforces

- `api(path)` refuses a path that does not start with one `/`, has a scheme, a backslash, or `..` or
  `.` as a path segment (also URL-encoded; the query may hold them): `AppApiError` `FORBIDDEN`, no request is sent. It sends
  `X-Agentage-App: {id}` and an `agcid`; the daemon refuses a request whose header names another id.
  The header is declared by the app itself: a guard against mistakes, not a boundary.
- Limit: an app runs in the same JavaScript realm as the shell. A raw `fetch` with no header is not
  stopped on the machine; `extension check` warns on `fetch(` in `src/app`.
- A `Split` is stored in `localStorage` key `ag.split.{app}.{id}` (and `.collapsed`); the CSS
  variables are the components ones (`splitVar`). The shell runs `SPLIT_PREPAINT` in the page
  head: it registers every key by that pattern, so the first paint is final.
- The shell owns the look of `.split`, `.sep` and `.card-err`; the app ships no layout CSS.
- Below 760 px a `Split` shows one pane; `pane` (0 or 1) picks it and the app gives the back button.
- There is no `base.css`: a plain `<input>` has no border. Use the components `Input` (or give it a class).

## Theme

`@agentage/extension/app/theme.css` is one Tailwind v4 `@theme` block: the shell palette (the
prototype hex values, `packages/shell-dashboard/e2e/prototype/index.html`) under the components token names. The shell and the app
build import it, so an app utility such as `bg-card` or `text-primary` matches the frame.

## Tests

`@agentage/extension/app/test-host` gives `TestHost`: the six regions as plain nodes and an in-memory host.
It records notices, api calls, the aside key and pages; `reply(call)` sets the api answer.

```tsx
import { createTestRecord, TestHost } from '@agentage/extension/app/test-host';

const record = createTestRecord();
render(
  <TestHost id="probe" record={record}>
    <App />
  </TestHost>
);
// click Ping -> record.calls[0].path === '/echo?msg=hi'
```

## Host adapters

`HostAdapter` (`kind`, `url`, `version`, `user`, `scopes`, `request(id, path, init)`) is the one seam per host kind. The shell
gives the local adapter (the daemon, no token); a cloud adapter comes later. The path a hook passes is
already checked.
