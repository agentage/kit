# @agentage/apphost

The agentage app host program. On a machine it is the daemon that the cli starts on `127.0.0.1:4243`: it runs each extension through a runner (a child process now), routes `/api/{id}`, `/mcp/{id}` and `/app/{id}`, serves the combined discovery `/.well-known/agentage-host.json`, the session `/shell/session` and the shell page.

```ts
import { createDaemon } from '@agentage/apphost';

const daemon = await createDaemon({ configDir, version, startedBy: 'cli' });
```

It builds on the extension kit `@agentage/extension`, a peer dependency (`~<kit minor>.<patch>`): the child entry, the host document schema and the combine function. Install it beside a kit of that minor. The kit does not import this package.

License: MIT
