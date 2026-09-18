import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import '../css/error-boundary.css'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * The last line of defence: without this, one thrown error anywhere in the
 * tree unmounts the whole app and leaves a blank white page with no way back
 * short of the browser's own reload button.
 *
 * It has to be a class -- React has no hook equivalent of componentDidCatch.
 *
 * Both actions below navigate with a full page load rather than through the
 * router on purpose. Whatever state produced the crash is still sitting in
 * memory, so re-rendering into it would very likely just crash again.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('wishli crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash">
        <div className="crash-inner">
          <p className="crash-eyebrow">Something broke</p>
          <h1 className="crash-title">
            That did not
            <br />
            go to plan.
          </h1>
          <p className="crash-note">
            Nothing you saved is lost — this page just could not draw itself. Reloading
            usually clears it.
          </p>

          <div className="crash-actions">
            <button type="button" className="crash-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            <button type="button" onClick={() => window.location.assign('/dashboard')}>
              Back to wishlists
            </button>
          </div>

          <details className="crash-details">
            <summary>What happened</summary>
            <pre>{error.message}</pre>
          </details>
        </div>
      </div>
    )
  }
}
