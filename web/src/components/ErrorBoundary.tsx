import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/**
 * Without this, one error while drawing a page unmounts the whole app and leaves a blank screen with no clue why.
 * `silent` hides just the broken piece (used for the settings button); otherwise the error is shown so it can be reported.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; silent?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('SpendX render error:', error, info.componentStack); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className="empty-state" role="alert">
        <Icon name="alert" size={24} />
        <p>This page hit an error.</p>
        <p className="muted small"><code>{error.message}</code></p>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
        <a className="link" href="#/">Go to SpendX home</a>
      </div>
    );
  }
}
