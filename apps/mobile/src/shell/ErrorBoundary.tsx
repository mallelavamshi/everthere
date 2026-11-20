import { Component, type ErrorInfo, type ReactNode } from 'react';
import { EmptyState } from '../ui';

interface State {
  failed: boolean;
}

/** Root error boundary: an illustrated "Oops" with a retry. Raw error text is never shown. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid h-full w-full place-items-center overflow-y-auto bg-cream text-ink">
        <EmptyState
          asset="empty.error"
          title="Oops! Something tumbled over"
          body="Don't worry, nothing is lost. Let's give it another go."
          action={{ label: 'Try again', onClick: () => this.setState({ failed: false }) }}
        />
      </div>
    );
  }
}
