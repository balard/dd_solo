/**
 * The start screen's run panel (v3 Phase 4b): Continue run, or New run -- which asks first
 * when it would overwrite a run still being played, naming what would be lost. A save the
 * app could not carry on is said here, once.
 *
 * The question is asked in the panel (4d), as the mockup drew it, rather than through
 * `window.confirm`: the game's Concede stopped using it in the same slice.
 */
import { useState } from 'react'

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
  const [asking, setAsking] = useState(false)
  const newRun = () => (view.kind === 'playing' ? setAsking(true) : onNewRun())
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
      {asking && view.kind === 'playing' ? (
        <div className="run-start-ask" role="alertdialog" aria-label="New run, over the one in progress?">
          <p className="run-start-title">New run, over the one in progress?</p>
          <p className="muted run-start-detail">{view.title} will be lost.</p>
          <div className="choices">
            <button type="button" className="choice secondary danger" onClick={onNewRun}>
              Lose it and start over
            </button>
            <button type="button" className="choice" onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
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
      )}
    </section>
  )
}
