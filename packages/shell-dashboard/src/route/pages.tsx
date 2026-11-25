import { EmptyState } from '@agentage/components/empty-state';
import { CircleSlash, PanelLeft } from 'lucide-react';
export { NoExtensions } from '../frame/no-extensions.js';

const I = { className: 'i', 'aria-hidden': true } as const;

export const NotFound = ({ path }: { path: string }) => (
  <div className="empty-main" data-page="not-found">
    <EmptyState
      icon={<CircleSlash {...I} />}
      title="Not found"
      description={`No installed app answers ${path}.`}
    />
  </div>
);

export const Removed = ({ title }: { title: string }) => (
  <div className="empty-main" data-page="removed">
    <EmptyState
      icon={<CircleSlash {...I} />}
      title={`${title} was removed`}
      description="Pick another app in the nav, or install it again."
    />
  </div>
);

// `/` with apps installed: the shell has no page of its own.
export const Home = () => (
  <div className="empty-main" data-page="home">
    <EmptyState
      icon={<PanelLeft {...I} />}
      title="Open an app"
      description="Pick one in the nav."
    />
  </div>
);
