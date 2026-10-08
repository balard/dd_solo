/**
 * The end-of-game summary (v2 Phase 3e), in the dialog where the decisions were.
 *
 * It is what a playtest leaves behind: how it ended, the turn, the time, and the
 * health left on each side. Everything but the time is read off the state by
 * `gameSummary`; the board stays scrollable underneath.
 */
import { formatClock, type GameSummary } from './summary'

/**
 * What the card leads to: New game, or in a run (v3 Phase 4b) the reward or the run's end,
 * with a line saying which (4d). `onClick` is null for the one frame before a run has
 * recorded the result, when the button cannot yet say where it goes.
 */
export interface GameOverNext {
  readonly label: string
  readonly note: string | null
  readonly onClick: (() => void) | null
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
      <p className="game-over-how">
        {summary.headline}.{next.note !== null && <> {next.note}</>}
      </p>
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
        <button type="button" className="choice" disabled={next.onClick === null} onClick={next.onClick ?? undefined}>
          {next.label}
        </button>
      </div>
    </div>
  )
}

/**
 * A question in the dialog, where the decisions are (v3 Phase 4d): Concede, which in a run
 * also offers Leave run. It replaced `window.confirm`, which could say only one sentence and
 * offer only yes or no -- and the run's question has a third answer, the one most players
 * want.
 */
export interface AskAnswer {
  readonly label: string
  readonly onClick: () => void
  readonly kind: 'primary' | 'secondary' | 'danger'
}

export function AskCard({ question, detail, answers }: { question: string; detail: string; answers: readonly AskAnswer[] }) {
  return (
    <div className="ask-card" role="alertdialog" aria-label={question}>
      <p className="question big">{question}</p>
      <p className="game-over-how">{detail}</p>
      <div className="choices">
        {answers.map((a) => (
          <button
            key={a.label}
            type="button"
            className={a.kind === 'primary' ? 'choice' : a.kind === 'danger' ? 'choice secondary danger' : 'choice secondary'}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
