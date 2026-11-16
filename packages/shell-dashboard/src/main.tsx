import { createRoot } from 'react-dom/client';
import { Frame } from './frame/frame.js';
import { NoExtensions } from './frame/no-extensions.js';
import { createRegionHost } from './frame/regions.js';
import { shellVersion } from './version.js';

const regions = createRegionHost();
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <Frame
      rows={[]}
      account={{ label: null, initials: '?' }}
      version={shellVersion()}
      title="Home"
      aside={null}
      regionRef={regions.ref}
      onNavigate={(href) => history.pushState(null, '', href)}
    >
      <NoExtensions />
    </Frame>
  );
