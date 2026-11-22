# @agentage/widget in detail

The short form is the [package README](../packages/widget/README.md).

## Theme, host and harness options

A host element's `data-theme="light"` or `"dark"` decides the theme, set by a shell at any time;
without it the system `prefers-color-scheme` decides. `useHost().context` carries `theme` and
`props` (`{}` by default). A shell builds the host for a deployment with
`createBridge({ id, baseUrl, token })` and sets `el.host` before it appends the element. The harness
page takes `?theme=light|dark`, `?widget=`, `?token=` and `?scope=` (the dev token's scope,
default `{id}:read`).

The root export also has `hostError(code, message)` (the error a bridge call throws),
`EnvelopeSchema` (the `{ success, data | error }` reply a bridge parses) and the types `FetchLike`
and `TokenSource`. The `@agentage/widget/register` subpath has `registerWidgets(id, widgets)`:
a shell page calls it with a loaded bundle's map to define the elements.

## Rules the code enforces

- An extension id and a widget name are lowercase kebab-case, at most 32 characters.
- `agentage-widget bundle [--dir <ext>]` exits 0 on success, 1 on failure, 2 on a usage error.
- A second bundle of the same id keeps the first element definition.

## Imports

- `@agentage/widget`: `useHost()`, `createBridge({ id, baseUrl, token })` (the id is required), the types `Host`,
  `HostContext`, `ToolOutputs`.
- `@agentage/widget/ds`: `Button` and `Card` (`title` plus children), styled inside the shadow root.
- `@agentage/widget/register`: `registerWidgets(id, widgets, { version })`.
- `@agentage/widget/bundle`: `bundle({ dir })`, also the bin `agentage-widget bundle`.

`useHost()` gives `tool(name, args)`, which resolves the tool's `structuredContent` and rejects
with its `error.code`. It also gives `api(path, init)`, which resolves the `/api/{id}` envelope's
`data`, and `context` (extension, version, path, theme, props).

## Bundle output

The bundler reads `agentage.id` and `version` from the extension's `package.json` and writes
`dist/ui/`:

- `{id}.js`: one minified ESM module with React, components and CSS. It calls `registerWidgets`
  on load.
- `widgets.json`: `[{ name, element, module: "/ui/{version}/{id}.js" }]`.
- `harness.html` and `harness.js`: the harness page.

## The harness page

- It mounts every widget from `widgets.json`, or the one in `?widget=<name>`.
- `tool` becomes a 2026-07-28 JSON-RPC `tools/call` on `POST /mcp`. `api` becomes `/api/{id}{path}` (the daemon and every app host), one call, no other base.
- Each call stops after 30 s. A refusal before the tool runs (401, 403, 503) rejects with the
  envelope's code.
- Token: `?token=` wins. On `localhost` or `127.0.0.1` it asks the dev issuer at
  `http://localhost:4281/token` for `?scope=` (5 s). Otherwise it calls anonymously.
- The page has no inline script, so it runs under the ui part's CSP.

A shell sets the element's `host` before it connects. Without one, the element uses
`globalThis.__agentageHost?.(element)`, else an anonymous same-origin bridge.
