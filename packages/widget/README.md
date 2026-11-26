# @agentage/widget

![agentage kit: your code uses the kit and runs on an app host](https://github.com/agentage/kit/raw/master/docs/banner.svg)

The agentage widget kit, for the `ui` part of an extension. You export a map of React components;
the kit registers each one as the custom element `{id}-{name}` in its own shadow root. `useHost()`
gives a widget its own tools and API, never a token. `agentage-widget bundle` builds the part.

```bash
npm install -D @agentage/widget
npm install react react-dom
```

This widget from the extension template calls the extension's MCP tool `{id}_echo`:

```tsx
// src/ui/echo.tsx
import { useState } from 'react';
import { useHost } from '@agentage/widget';
import { Button, Card } from '@agentage/widget/ds';

export function Echo() {
  const { tool, context } = useHost();
  const [answer, setAnswer] = useState('');
  const ping = () =>
    tool(`${context.extension}_echo`, { msg: 'hi' }).then(
      ({ msg }) => String(msg),
      (error: Error) => error.message
    );
  return (
    <Card title={context.extension}>
      <Button onClick={async () => setAnswer(await ping())}>ping</Button>
      <p>{answer}</p>
    </Card>
  );
}

// src/ui/index.ts
export const widgets = { echo: Echo };
```

Since 0.6.0 a widget calls a tool of its own id in the form `{id}_{name}` or the old `{id}__{name}`.
A tool of another id is refused with `FOREIGN_TOOL`.

```bash
npx agentage-widget bundle   # writes dist/ui/{id}.js, widgets.json and the harness page
```

Since 0.5.0, `Button` and `Card` take their look from `@agentage/components` ^0.21, not from
`@agentage/design-system`.

- Themes, the imports, the bundle output, the harness page and the rules:
  [docs/widget.md](https://github.com/agentage/kit/blob/master/docs/widget.md).
- The whole kit: the [kit README](https://github.com/agentage/kit#readme).

License: MIT
