/**
 * What the game is waiting for, and the only legal ways to answer it.
 *
 * Rendered entirely from `state.pending` via `promptFor`, so this component never
 * decides what is legal and never tracks where it is in a multi-step move -- the
 * engine already knows both. The one piece of local state is the damage selection,
 * which is a draft answer rather than wizard position.
 */
import {
  livingUnits,
  type GameAction,
  type GameState,
  type Pending,
  type PlayerId,
  type TerrainSlot,
  type UnitId,
} from '../../engine/types'

import { damageSelection, promptFor, slotLabel } from './prompts'

export function ActionBar({
  state,
  human,
  pending,
  opponentThinking,
  selection,
  onClearSelection,
  dispatch,
}: {
  state: GameState
  human: PlayerId
  pending: Pending | null
  opponentThinking: boolean
  selection: ReadonlySet<UnitId>
  onClearSelection: () => void
  dispatch: (action: GameAction) => void
}) {
  if (state.winner !== null) {
    return (
      <div className="action-bar">
        <p className="question big">{state.winner === human ? 'You win.' : 'You lose.'}</p>
      </div>
    )
  }

  if (pending === null) {
    return (
      <div className="action-bar">
        <p className="question muted">Nothing to do.</p>
      </div>
    )
  }

  if (pending.player !== human) {
    return (
      <div className="action-bar">
        <p className="question muted">
          {opponentThinking ? 'The enemy is deciding...' : 'Waiting for the enemy...'}
        </p>
      </div>
    )
  }

  const prompt = promptFor(pending, human)

  if (prompt.custom === 'assign_damage' && pending.kind === 'assign_damage') {
    const { absorbed, required, ready, suggestion } = damageSelection(state, pending, selection)

    return (
      <div className="action-bar">
        <p className="question">
          {pending.damage} damage at {slotLabel(pending.slot, human)}
          {required === 0 ? (
            <span className="muted"> — too little to kill anything</span>
          ) : (
            <span className="muted"> — choose units to lose</span>
          )}
        </p>

        {required > 0 && (
          <p className={`tally ${ready ? 'is-ready' : ''}`}>
            absorbed <b>{absorbed}</b> / must reach <b>{required}</b>
            {!ready && absorbed > 0 && <span className="muted"> — take as much as you can</span>}
          </p>
        )}

        <div className="choices">
          <button
            type="button"
            className="choice"
            disabled={!ready}
            onClick={() => {
              dispatch({ kind: 'assign_damage', unitIds: [...selection] })
              onClearSelection()
            }}
          >
            {required === 0 ? 'Continue' : 'Confirm losses'}
          </button>
          {required > 0 && (
            <>
              <button
                type="button"
                className="choice secondary"
                onClick={() => {
                  dispatch({ kind: 'assign_damage', unitIds: suggestion })
                  onClearSelection()
                }}
              >
                Auto
              </button>
              <button type="button" className="choice secondary" onClick={onClearSelection}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  if (prompt.custom === 'reinforce' || prompt.custom === 'retreat') {
    const movable =
      prompt.custom === 'reinforce'
        ? livingUnits(state, human).filter((u) => u.location.kind === 'reserve')
        : livingUnits(state, human).filter((u) => u.location.kind === 'terrain')
    const chosen = [...selection].filter((id) => movable.some((u) => u.id === id))

    return (
      <div className="action-bar">
        <p className="question">
          {prompt.question}
          <span className="muted">
            {' '}
            — tap units below{chosen.length > 0 ? ` (${chosen.length} chosen)` : ''}
          </span>
        </p>
        <div className="choices">
          {prompt.custom === 'retreat' ? (
            <button
              type="button"
              className="choice"
              onClick={() => {
                dispatch({ kind: 'retreat', unitIds: chosen })
                onClearSelection()
              }}
            >
              {chosen.length === 0 ? 'Keep everyone deployed' : `Pull back ${chosen.length}`}
            </button>
          ) : (
            <>
              {chosen.length === 0 ? (
                <button
                  type="button"
                  className="choice"
                  onClick={() => dispatch({ kind: 'reinforce', moves: [] })}
                >
                  Leave them in reserve
                </button>
              ) : (
                (['p1_home', 'frontier', 'p2_home'] as TerrainSlot[]).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className="choice"
                    onClick={() => {
                      dispatch({
                        kind: 'reinforce',
                        moves: chosen.map((unitId) => ({ unitId, slot })),
                      })
                      onClearSelection()
                    }}
                  >
                    To {slotLabel(slot, human)}
                  </button>
                ))
              )}
            </>
          )}
          {chosen.length > 0 && (
            <button type="button" className="choice secondary" onClick={onClearSelection}>
              Clear
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="action-bar">
      <p className="question">{prompt.question}</p>
      <div className="choices">
        {prompt.choices.map((choice, i) => (
          <button
            key={i}
            type="button"
            className={`choice ${choice.passive ? 'secondary' : ''}`}
            onClick={() => {
              dispatch(choice.action)
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  )
}
