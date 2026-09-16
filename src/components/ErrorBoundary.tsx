import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearRestoreState } from '../controller';
import { store } from '../store';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * Last resort for a crash during render. Without it the tree unmounts and leaves a blank
 * page — and because everything is stored locally, the state that crashed is also what
 * gets restored on reload, so the only way out is to clear it. That's what "Reset" does.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error', error, info);
    this.setState({ info: info.componentStack ?? '' });
  }

  private reset = async () => {
    await clearRestoreState();
    location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const file = store.get().file?.name;
    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>
            The app hit an unexpected error{file ? <> while working on “{file}”</> : null}. Nothing was uploaded, and
            your file on disk is untouched.
          </p>
          <p className="crash-message">{error.message || String(error)}</p>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="btn" onClick={() => void this.reset()}>
              Reset saved data &amp; reload
            </button>
            <a className="btn" href="https://github.com/mikehoyle/transcription-companion/issues/new/choose" target="_blank" rel="noopener noreferrer">
              Report this
            </a>
          </div>
          <p className="crash-hint">
            Reload keeps your markers, loops and settings. Reset discards the saved session for this file and the
            remembered file itself — use it if reloading lands you back here.
          </p>
          {(error.stack || info) && (
            <details className="crash-details">
              <summary>Technical details</summary>
              <pre>{`${error.stack ?? error.message}${info}`}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
