import { EmptyState } from '@agentage/design-system/empty-state';
import { Puzzle } from 'lucide-react';

// The shell has no content of its own: with no app installed, main says how to add one.
export const NoExtensions = () => (
  <div className="empty-main" data-page="empty">
    <EmptyState
      icon={<Puzzle className="i" aria-hidden="true" />}
      title="No extensions"
      description="Install one with: agentage extension install <name>"
    />
  </div>
);
