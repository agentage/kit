# @agentage/extension

![agentage kit: your code uses the kit and runs on an app host](https://github.com/agentage/kit/raw/master/docs/banner.svg)

The extension kit of agentage. You write each part of an extension as one `create(ctx)` function.
The kit owns the server, the port, `/health`, auth, the store and the images. It also holds the
build tool that the `agentage extension` commands run. It is for extension authors.

```bash
npm install @agentage/extension express zod
```

A part is one folder in `src/`. This MCP part, from the extension template, serves the tool
`{id}_echo` on `POST /mcp`:

```ts
import { type McpContext } from '@agentage/extension';
import { z } from 'zod';

export function create(ctx: McpContext) {
  ctx.tool(
    'echo',
    {
      description: 'Echo a message back',
      scope: 'read',
      input: z.object({ msg: z.string().min(1).max(200) }),
      output: z.object({ msg: z.string() }),
    },
    async ({ msg }) => ({ msg: `pong ${msg}` })
  );
}
```

Since 0.23.0 the kit names each tool `{id}_{name}`, with one underscore. Its schemas still accept
the old `{id}__{name}` for now, and refuse a tool of another id.

Start a new extension with `npx @agentage/cli extension create my-ext`: it pins this kit for you.

Since 0.23.0, `check` asks an app part for `@agentage/components` ^0.21, the library that replaces
`@agentage/design-system`.

- The subpaths, the core client, the check report and secrets:
  [docs/extension-package.md](https://github.com/agentage/kit/blob/master/docs/extension-package.md).
- Every part kind: [docs/parts.md](https://github.com/agentage/kit/blob/master/docs/parts.md). The tool:
  [docs/tool.md](https://github.com/agentage/kit/blob/master/docs/tool.md). The whole kit: the
  [kit README](https://github.com/agentage/kit#readme).

License: MIT
