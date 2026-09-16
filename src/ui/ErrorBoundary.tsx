/**
 * Last line of defence.
 *
 * An alpha will crash. When it does, the useful thing is not a blank page but the
 * seed and the moves that produced it -- which, because a game *is* its record, is
 * enough for anyone to reproduce the failure exactly.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { currentRecord } from './game/useGame'

interface Props {
  readonly children: ReactNode
}

interface State {
  readonly error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('dd_solo crashed', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    // Off the hook rather than out of storage: saving is switched off, and by the
    // time this renders the tree that held the game is gone.
    const record = currentRecord()

    return (
      <div className="app">
        <div className="recovery">
          <h1>Something went wrong.</h1>
          <p className="error-message">{error.message}</p>

          {record !== null && (
            <>
              <p className="muted">
                This game was seed <b>{record.setup.seed}</b> after {record.actions.length} move
                {record.actions.length === 1 ? '' : 's'}. That is enough to reproduce it exactly.
              </p>
              <details>
                <summary>Copy the game record</summary>
                <textarea readOnly rows={8} value={JSON.stringify(record)} />
              </details>
            </>
          )}

          <div className="choices">
            <button type="button" className="choice" onClick={() => window.location.reload()}>
              Start over
            </button>
          </div>
        </div>
      </div>
    )
  }
}
