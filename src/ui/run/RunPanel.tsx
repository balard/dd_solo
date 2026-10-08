/**
 * The start screen's run panel (v3 Phase 4b): Continue run, or New run -- which asks first
 * when it would overwrite a run still being played, naming what would be lost. A save the
 * app could not carry on is said here, once.
 */
import type { RunLoad } from '../../run/save'

import { savedRunView } from './runView'

export function RunPanel({
  saved,
  onContinue,
  onNewRun,
}: {
  saved: RunLoad
  onContinue: () => void
  onNewRun: () => void
}) {
  const view = savedRunView(saved)
  const newRun = () => {
    if (view.kind !== 'playing' || window.confirm(`Start a new run? ${view.title} will be lost.`)) onNewRun()
  }
  return (
    <section className="run-start" aria-label="Runs">
      {view.kind === 'discarded' && <p className="banner warn">{view.message}</p>}
      <div className="run-start-body">
        {view.kind === 'playing' ? (
          <>
            <p className="new-game-label">Run in progress</p>
            <p className="run-start-title">{view.title}</p>
            <p className="muted run-start-detail">{view.detail}</p>
          </>
        ) : (
          <>
            <p className="new-game-label">Runs</p>
            <p className="run-start-title">Pick a race, start from 12 health, fight three acts.</p>
            <p className="muted run-start-detail">A run is saved between battles, in this browser.</p>
          </>
        )}
      </div>
      <div className="choices">
        {view.kind === 'playing' && (
          <button type="button" className="choice" onClick={onContinue}>
            Continue run
          </button>
        )}
        <button type="button" className={view.kind === 'playing' ? 'choice secondary' : 'choice'} onClick={newRun}>
          New run
        </button>
      </div>
    </section>
  )
}
