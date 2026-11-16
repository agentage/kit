# @agentage/app

The one import of an agentage app. An app is one root component (the default export of
`src/app/index.tsx`); the shell mounts it in the `main` region and gives it these hooks. The app has
no code for layout, auth or storage.

The shell serves one copy of React and of this package through an import map: an app bundle keeps
`react`, `react-dom` and `@agentage/app` external.

## The calls

| Call                      | What it gives                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAppShell()`           | `{ id, route: { path, query }, notify({ text, kind }), openAside(key), closeAside(), navigate(page) }`; `route.path` is the page after `/{id}/` |
| `useAppHost()`            | `{ id, user, scopes, api(path, init?) }`; `api('/echo')` calls `/api/{id}/echo` and returns the envelope `data`                                 |
| `useAppState(key, init)`  | `[value, set]`, kept by the shell per app and key: a remount (a new build, an update) keeps it; every reader of a key sees one value            |
| `<Region name>`           | renders its children into a frame region (`actions`, `aside`, `notices`, `bottom`, `side`) as a React portal, inside an error boundary          |
| `<Split id init min max>` | two panes, the first one resizable (arrow keys 16 px, Shift 64 px, Home, End, drag); the size holds across a reload with no layout shift        |
| `AppBoundary`             | the error boundary the shell puts around each app root and `Region`                                                                             |
| `AppApiError`             | what `api` throws: `code` (the envelope code, `FORBIDDEN` for a refused path, else `HTTP_<status>`), `status`                                   |

Keys of `openAside`: `inspect`, `details`, `inbox` (the shell puts the key in the URL, `?details=1`).

## Rules the code enforces

- `api(path)` refuses a path that does not start with one `/`, has a scheme, a backslash, or `..` or
  `.` as a path segment (also URL-encoded; the query may hold them): `AppApiError` `FORBIDDEN`, no request is sent. It sends
  `X-Agentage-App: {id}` and an `agcid`; the daemon refuses a request whose header names another id.
  The header is declared by the app itself: a guard against mistakes, not a boundary (K10).
- Limit: an app runs in the same JavaScript realm as the shell. A raw `fetch` with no header is not
  stopped on the machine; `extension check` warns on `fetch(` in `src/app`.
- A `Split` size is the CSS variable `--split-{app}-{id}`, stored in `localStorage` key
  `ag.split.{app}.{id}`. The shell runs `SPLIT_PREPAINT` in the page head before any module, and the
  split clamps the stored value to its own `min` and `max` in CSS, so the first paint is final.
- The shell owns the look of `.split`, `.sep` and `.card-err`; the app ships no layout CSS.

## Theme

`@agentage/app/theme.css` is one Tailwind v4 `@theme` block: the shell palette (the
`shell-samples/index.html` hex values) under the design-system token names. The shell and the app
build import it, so an app utility such as `bg-card` or `text-primary` matches the frame.

## Tests

`@agentage/app/test-host` gives `TestHost`: the five regions as plain nodes and an in-memory host.
It records notices, api calls, the aside key and pages; `reply(call)` sets the api answer.

```tsx
import { createTestRecord, TestHost } from '@agentage/app/test-host';

const record = createTestRecord();
render(
  <TestHost id="probe" record={record}>
    <App />
  </TestHost>
);
// click Ping -> record.calls[0].path === '/echo?msg=hi'
```

## Host adapters

`HostAdapter` (`user`, `scopes`, `request(id, path, init)`) is the one seam per host kind. The shell
gives the local adapter (the daemon, no token); a cloud adapter comes later. The path a hook passes is
already checked.
