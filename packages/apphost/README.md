# @agentage/apphost

The agentage app host program. On a machine it is the daemon that the cli starts on `127.0.0.1:4243`: it runs each extension through a runner (a child process now), routes `/api/{id}`, `/mcp/{id}` and `/app/{id}`, serves the combined discovery `/.well-known/agentage-host.json`, the session `/shell/session` and the shell page.

```ts
import { createDaemon } from '@agentage/apphost';

const daemon = await createDaemon({ configDir, version, startedBy: 'cli' });
```

It builds on the extension kit `@agentage/extension`, a peer dependency (`~<kit minor>.<patch>`): the child entry, the host document schema and the combine function. Install it beside a kit of that minor. The kit does not import this package.

## The cloud entry

The bin `agentage-apphost-cloud` runs a cloud app host. It reads `installation.json` and `upstreams.json` of the host. The cloud form of `installation.json` names the program on one line:

```json
{
  "host": "platform",
  "program": { "version": "0.2.2" },
  "shell": { "package": "@agentage/shell-dashboard" },
  "extensions": [{ "id": "fixture", "version": "0.2.19", "expose": { "api": "public" } }]
}
```

- `program.version` must be the version of this program, or the start is refused.
- `shell` names a package only. The program serves the shell version it carries and reports that version in the host document.
- `source` and `enabled` are for a machine only. A row needs a `version`.
- The ids `router` and `host`, an id that ends in `-pages` and a shell package as a row are refused. Only one row serves pages.

`agentage-apphost-cloud --check DIR` runs the checks of the start on `DIR/installation.json` and `DIR/upstreams.json`. It also refuses a `host` that is not the folder name. It needs no env and never listens. It prints one line for each refusal and exits 0 or 1. The files in `fixtures/check/` show the form.

License: MIT
