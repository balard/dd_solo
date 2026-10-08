/**
 * The end-of-game summary (v2 Phase 3e), in the dialog where the decisions were.
 *
 * It is what a playtest leaves behind: how it ended, the turn, the time, and the
 * health left on each side. Everything but the time is read off the state by
 * `gameSummary`; the board stays scrollable underneath.
 */
import { formatClock, type GameSummary } from './summary'

/** What the card leads to: New game, or in a run (v3 Phase 4b) the reward or the run's end. */
export interface GameOverNext {
  readonly label: string
  readonly onClick: () => void
}

export function GameOver({ summary, next }: { summary: GameSummary; next: GameOverNext }) {
  const side = (who: string, { left, of }: GameSummary['mine']) => (
    <div className="game-over-side">
      <dt>{who}</dt>
      <dd>
        <b>{left}</b> <span className="muted">of {of} health left</span>
      </dd>
    </div>
  )
  return (
    <div className={summary.won ? 'game-over is-won' : 'game-over'}>
      <p className="question big">{summary.won ? 'You win.' : 'You lose.'}</p>
      <p className="game-over-how">{summary.headline}.</p>
      <dl className="game-over-facts">
        <div className="game-over-side">
          <dt>Ended</dt>
          <dd>{summary.turn === 0 ? <b>before the first turn</b> : <>on turn <b>{summary.turn}</b></>}</dd>
        </div>
        <div className="game-over-side">
          <dt>Time</dt>
          <dd>
            <b>{formatClock(summary.elapsedMs)}</b>
          </dd>
        </div>
        {side('You', summary.mine)}
        {side('Enemy', summary.theirs)}
      </dl>
      <div className="choices">
        <button type="button" className="choice" onClick={next.onClick}>
          {next.label}
        </button>
      </div>
    </div>
  )
}
