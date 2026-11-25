# @agentage/shell-dashboard

![agentage kit: your code uses the kit and runs on an app host](https://github.com/agentage/kit/raw/master/docs/banner.svg)

The agentage dashboard shell: one static folder that an app host serves at `/`. It shows the nav,
one row per installed app, and the open app. You do not install it yourself: `@agentage/apphost`
depends on it and serves it, on your machine and in a cloud.

```bash
npm install @agentage/shell-dashboard
```

A host finds the folder like this and serves `dist/*` at `/shell/*`:

```ts
const page = import.meta.resolve('@agentage/shell-dashboard/dist/index.html');
```

An app reaches the shell through `@agentage/extension/app` (`useAppShell`, `Region`, `Split`).

Since 0.5.0 the shell is built on `@agentage/components` ^0.21, not on `@agentage/design-system`.

- The bundle, the Content Security Policy, the regions, the nav and the tests:
  [docs/shell-dashboard.md](https://github.com/agentage/kit/blob/master/docs/shell-dashboard.md).
- The whole kit: the [kit README](https://github.com/agentage/kit#readme).

License: MIT
