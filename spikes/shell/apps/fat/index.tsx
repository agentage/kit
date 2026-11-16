// Negative control: built WITHOUT externals, so it carries its own React copy.
import { useState } from 'react';

(window as unknown as { __hooks: Set<unknown> }).__hooks.add(useState);
const FatApp = () => {
  const [n] = useState(1);
  return <p>fat {n}</p>;
};
export default FatApp;
