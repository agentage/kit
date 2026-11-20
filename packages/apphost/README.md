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
  "program": { "version": "0.3.0" },
  "shell": { "package": "@agentage/shell-dashboard" },
  "extensions": [{ "id": "fixture", "version": "0.2.19", "expose": { "api": "public" } }]
}
```

- `program.version` must be the version of this program, or the start is refused.
- `shell` names a package only. The program serves the shell version it carries and reports that version in the host document.
- `source` and `enabled` are for a machine only. A row needs a `version`.
- The ids `router` and `host`, an id that ends in `-pages` and a shell package as a row are refused. Only one row serves pages.

The router writes one request line per call as extension `host`, part `router`. Its route names the id of the matched row (`/api/{id}/*` with the real id, also on a 503 of a starting row); a path of no row is `(unmatched)`. It sends its `agcid` upstream, so the upstream rows carry the same id. Env: `AGENTAGE_URL` is required; `AGENTAGE_CORE_URL` is optional and not read (a value that is set must still be an https origin).

The route of the line is `/api/{id}/*` or `/mcp/{id}/*` for an id of a row. A path of a pages host that no row of `/api`, `/mcp` or `/app` takes has the route `/*`, and its `/.well-known/` names have `/.well-known/*`. `(unmatched)` is the route of every request that no row and no route answers: an `/api`, `/mcp` or `/app` path whose id is of no row (a caller id never reaches the line), and any other path on a host with no pages row.

### Security headers

The cloud router and the daemon send the same set, from `helmet` with the values of the edge, so a header the edge also sets never has two values. The values:

| Header                              | Value                             |
| ----------------------------------- | --------------------------------- |
| `Cross-Origin-Opener-Policy`        | `same-origin`                     |
| `Cross-Origin-Resource-Policy`      | `same-origin`                     |
| `Origin-Agent-Cluster`              | `?1`                              |
| `Referrer-Policy`                   | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security`         | `max-age=31536000`                |
| `X-Content-Type-Options`            | `nosniff`                         |
| `X-DNS-Prefetch-Control`            | `off`                             |
| `X-Download-Options`                | `noopen`                          |
| `X-Frame-Options`                   | `DENY`                            |
| `X-Permitted-Cross-Domain-Policies` | `none`                            |
| `X-XSS-Protection`                  | `0`                               |

- `Strict-Transport-Security` is sent only when `AGENTAGE_URL` starts with `https:`. The daemon (loopback http) never sends it.
- There is no `Content-Security-Policy` header from the program (`contentSecurityPolicy: false`). The shell page carries its own policy in a meta tag, and a proxied answer keeps the policy of its upstream.
- On a proxied answer the upstream value of a header replaces the program value, so there is one value per name.
- `Cross-Origin-Resource-Policy: same-origin` stops a page on another origin from showing an image that the router serves. A public site that wants hot-linked images must send its own value.

`agentage-apphost-cloud --check DIR` runs the checks of the start on `DIR/installation.json` and `DIR/upstreams.json`. It also refuses a `host` that is not the folder name. It needs no env and never listens. It prints one line for each refusal and exits 0 or 1. The files in `fixtures/check/` show the form.

License: MIT
