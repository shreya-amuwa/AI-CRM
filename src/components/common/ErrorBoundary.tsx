import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Home } from 'lucide-react';
import * as Sentry from '@sentry/react';
import { isChunkLoadError, isReloadingForNewVersion, reloadForNewVersion } from '../../lib/chunkReload';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // a screen of the previous build could not be loaded: start the reload now, so the first thing shown is "Loading the latest
    // version", not an error page (once per 30 seconds; after that the page offers the reload button instead)
    if (isChunkLoadError(error)) reloadForNewVersion();
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    // An old tab after a deployment: reload once to get the new version (not a defect, not reported).
    if (isChunkLoadError(error)) { reloadForNewVersion(); return; }
    // A screen that crashed: reported with the component stack (the report is masked, see src/instrument.ts); does nothing without a DSN.
    Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack ?? '' } } });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleResetState = () => {
    try {
      localStorage.removeItem('unified_crm_leads');
      sessionStorage.clear();
    } catch {}
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const updated = isChunkLoadError(this.state.error);
      // a new version is being loaded (the page reloads in a moment): a quiet light screen, never a dark error page that flashes
      if (updated && isReloadingForNewVersion()) {
        return (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" role="status" aria-live="polite" data-testid="app-updating">
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-hidden />
              Loading the latest version…
            </p>
          </div>
        );
      }
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4 sm:p-6" data-testid="app-error">
          <div role="alert" className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 text-center">
            <div className="w-12 h-12 rounded-lg bg-slate-100 text-slate-500 mx-auto flex items-center justify-center">
              {updated ? <RefreshCw className="w-6 h-6" aria-hidden /> : <AlertTriangle className="w-6 h-6" aria-hidden />}
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-slate-900">
                {updated ? 'A new version is available' : 'Something went wrong'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {updated
                  ? 'The CRM was just updated. Reload the page to continue.'
                  : 'This screen could not be shown. Reload the page; if it happens again, go back to the home page.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full sm:flex-1 h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" aria-hidden />
                <span>Reload page</span>
              </button>
              {!updated ? (
                <button
                  type="button"
                  onClick={this.handleResetState}
                  className="w-full sm:flex-1 h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold flex items-center justify-center gap-1.5"
                >
                  <Home className="w-4 h-4" aria-hidden />
                  <span>Go to home page</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
