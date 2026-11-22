# @agentage/apphost

![agentage kit: your code uses the kit and runs on an app host](https://github.com/agentage/kit/raw/master/docs/banner.svg)

The agentage app host program: it runs extensions. On your machine it is the daemon that
`@agentage/cli` starts on `127.0.0.1:4243`. In a cloud it is the bin `agentage-apphost-cloud`. Both
route `/api/{id}`, `/mcp/{id}` and `/app/{id}` to the extensions and serve the dashboard shell at `/`.

```bash
npm install @agentage/apphost @agentage/extension
```

The kit `@agentage/extension` is a peer dependency: install the kit minor that this version names.
The cli starts the daemon this way:

```ts
import { createDaemon } from '@agentage/apphost';

const daemon = await createDaemon({ configDir, version, startedBy: 'cli' });
```

A cloud app host reads `installation.json` and `upstreams.json` of its folder. Check a folder
before you start it. The command never listens; it prints one line per refusal and exits 0 or 1:

```bash
npx agentage-apphost-cloud --check ./my-host
```

- The `installation.json` form, the request lines and the security headers:
  [docs/apphost.md](https://github.com/agentage/kit/blob/master/docs/apphost.md).
- The daemon routes, limits and seal: [docs/daemon.md](https://github.com/agentage/kit/blob/master/docs/daemon.md).
- The whole kit: the [kit README](https://github.com/agentage/kit#readme).

License: MIT
