import { Component } from 'react';

/**
 * The last line of defence.
 *
 * If something in here goes wrong in a way nobody thought of, the person using
 * it should still be told what happened, in words, rather than be left with a
 * blank white page and their afternoon's work gone.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, detail: '' };
  }

  static getDerivedStateFromError(error) {
    return { failed: true, detail: error?.message ?? '' };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="app">
        <div className="crash" role="alert" data-testid="crash">
          <h1>Something went wrong in this app.</h1>
          <p>
            Your files were never sent anywhere, and nothing was saved. Reload the page and try
            again; if it happens with the same file every time, that file is worth reporting.
          </p>
          {this.state.detail && (
            <p className="crash-detail">
              What went wrong, for a report: <code>{this.state.detail}</code>
            </p>
          )}
          <button type="button" className="button" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
