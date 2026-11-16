// Heavier app for the rebuild timing: design-system components bundled, React external.
import { useState } from 'react';
import { Badge } from '@agentage/design-system/badge';
import { Button } from '@agentage/design-system/button';
import { Card } from '@agentage/design-system/card';

const LABEL = 'DS v0';
(window as unknown as { __hooks: Set<unknown> }).__hooks.add(useState);
const DsApp = () => (
  <Card>
    <h1>{LABEL}</h1>
    <Badge>beta</Badge>
    <Button>Save</Button>
  </Card>
);
export default DsApp;
