import { Component, type ReactNode } from 'react';

interface Props {
  // Shown in the card and on `data-error-card`.
  name: string;
  children: ReactNode;
  // Optional custom card; the default is a small alert.
  fallback?: (error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

// Around each app root and each Region: a broken app shows a card, the frame keeps working.
export class AppBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);
    return (
      <div role="alert" className="card-err" data-error-card={this.props.name}>
        <strong>{this.props.name} failed.</strong> {error.message}
      </div>
    );
  }
}
