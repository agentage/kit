# @agentage/shell-dashboard

The dashboard shell: one static folder that a host serves at `/`. It is the frame of the accepted
prototype (`shell-samples/index.html`, variant B) in React 19, styled by Tailwind v4 with the
`@agentage/design-system` token files (no `base.css`) and the prototype CSS as a `components` layer.

## Bundle output

`npm run build` writes `dist/`:

| Path                               | Served at              | What                                                                                  |
| ---------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `dist/index.html`                  | `/` and every app page | pre-paint scripts, the import map, `<meta name="agentage-shell" content="<version>">` |
| `dist/shell/shell.js`, `shell.css` | `/shell/*`             | the frame                                                                             |
| `dist/shell/vendor/*.js`           | `/shell/vendor/*`      | one React, react-dom and `@agentage/app` for the shell and every app                  |

A host finds the folder with `import.meta.resolve('@agentage/shell-dashboard/dist/index.html')`.

## Regions

`data-region` names from the prototype: `mobile-header`, `nav`, `notices`, `account`, `main`,
`actions`, `bottom`, `side`, `aside`, plus `toasts`. Apps reach `actions`, `aside`, `notices`,
`bottom` and `side` through `Region` of `@agentage/app`.

## Rules the code enforces

- Tokens: one `@theme` block in `src/styles/shell.css` puts the prototype hex values under the
  design-system names (`--color-background`, `--color-card`, `--color-accent` = hover surface,
  `--color-primary` = amber). `frame.css` reads only those names.
- No layout shift: the pre-paint script in `index.html` sets `--nav-full`, `--aside-w`, `--bot-h`
  and the `nh` (nav hidden) and `bo` (bottom open) classes from `localStorage` (`ag.nav`,
  `ag.aside`, `ag.bot`, `ag.navh`, `ag.bot.open`) before any module; `SPLIT_PREPAINT` of
  `@agentage/app` does the same for app splits.
- Splitters (`role="separator"`): drag, arrows 16 px, Shift 64 px, Home, End.
- `Ctrl+K` opens the command list (design-system `Command`): one line per app and "Toggle sidebar".
- Design-system components by subpath: `command`, `dropdown-menu` (account), `icon-button`, `kbd`.

## Tests

`npm run test:e2e -w @agentage/shell-dashboard` builds `dist-e2e/` with a fixture page (the frame
filled like the prototype), serves it beside a copy of the prototype (`e2e/prototype/index.html`,
a neutral account name), and checks at 1280 and 400 px: the pixel difference, axe WCAG A and AA,
CLS 0 after a reload, the keys and the phone layout. Screenshots and `diff-<width>.json` land in
`shots/`.
