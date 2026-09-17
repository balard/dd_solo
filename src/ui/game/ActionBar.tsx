/**
 * What the game is waiting for, and the only legal ways to answer it.
 *
 * Rendered entirely from `state.pending` via `promptFor`, so this component never
 * decides what is legal and never tracks where it is in a multi-step move -- the
 * engine already knows both. The one piece of local state is the damage selection,
 * which is a draft answer rather than wizard position.
 */
import { Fragment } from 'react'

import { terrainDie, terrainFaceAction, unitType } from '../../data/load'

import type { TerrainFaceNumber } from '../../data/types'

import {
  livingUnits,
  type GameAction,
  type GameState,
  type Pending,
  type PlayerId,
  type TerrainSlot,
  type UnitId,
} from '../../engine/types'

import { Glyph, type GlyphName } from './Glyph'
import {
  damageSelection,
  saiTargetSelection,
  describeFace,
  plainLabel,
  promptFor,
  reinforcePlan,
  slotLabel,
  type FaceHint,
  type ReinforceMove,
} from './prompts'

import { useFaceArt } from './useFaceArt'

export function ActionBar({
  state,
  human,
  pending,
  opponentThinking,
  selection,
  staged,
  onStage,
  onClearSelection,
  onClearDraft,
  dispatch,
}: {

  state: GameState
  human: PlayerId
  pending: Pending | null
  opponentThinking: boolean
  selection: ReadonlySet<UnitId>
  /** The reinforce draft: which reserve dice are going where, so far. */
  staged: readonly ReinforceMove[]
  onStage: (moves: readonly ReinforceMove[]) => void
  onClearSelection: () => void
  /** Clear is not "unselect": mid-reinforce it has to drop the staged moves too. */
  onClearDraft: () => void

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

  const prompt = promptFor(pending, human, state)

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

  /**
   * The same sheet as a damage assignment, pointed at the army opposite.
   *
   * It shares `damageSelection`'s arithmetic through `saiTargetSelection`, because the
   * rule really is the same one: "you must apply the SAI's effect to the fullest
   * extent possible by selecting the maximum number of targets allowed" (p. 32). What
   * changes is the wording -- you are choosing what to destroy rather than what to
   * lose -- and whose dice light up, which `SelectMode.side` decides.
   */
  if (prompt.custom === 'sai_target' && pending.kind === 'sai_target') {
    const { absorbed, required, ready, suggestion } = saiTargetSelection(state, pending, selection)

    return (
      <div className="action-bar">
        <p className="question">
          <b>{pending.sai}</b> — target{' '}
          {pending.limit.kind === 'one' ? 'one die' : `${pending.limit.budget} health-worth`} at{' '}
          {slotLabel(pending.slot, human)}
          <span className="muted">
            {' '}
            — choose enemy units
            {pending.remaining > 1 && ` (${pending.remaining} to place)`}
          </span>
        </p>

        <p className={`tally ${ready ? 'is-ready' : ''}`}>
          targeted <b>{absorbed}</b> / must reach <b>{required}</b>
          {!ready && absorbed > 0 && <span className="muted"> — take as much as you can</span>}
        </p>

        <div className="choices">
          <button
            type="button"
            className="choice"
            disabled={!ready}
            onClick={() => {
              dispatch({ kind: 'sai_target', unitIds: [...selection] })
              onClearSelection()
            }}
          >
            Confirm targets
          </button>
          <button
            type="button"
            className="choice secondary"
            onClick={() => {
              dispatch({ kind: 'sai_target', unitIds: suggestion })
              onClearSelection()
            }}
          >
            Auto
          </button>
          <button type="button" className="choice secondary" onClick={onClearSelection}>
            Clear
          </button>
        </div>
      </div>
    )
  }

  if (prompt.custom === 'reinforce') {
    // "You may move any or all of them to any terrains. You may split the reserve
    // units up, sending some to one terrain and some to another." So a destination
    // button stages rather than dispatches, and one action still reaches the engine
    // when the player is done.
    const plan = reinforcePlan(state, human, staged)
    const chosen = [...selection].filter((id) => plan.unassigned.some((u) => u.id === id))

    return (
      <div className="action-bar">
        <p className="question">
          {prompt.question}
          <span className="muted">
            {chosen.length > 0
              ? ` — ${chosen.length} chosen; send ${chosen.length === 1 ? 'it' : 'them'} where?`
              : plan.unassigned.length > 0
                ? ' — tap units below'
                : ' — every die has a destination'}
          </span>
        </p>

        {plan.byDestination.length > 0 && (
          <p className="staged muted">
            {plan.byDestination.map((group, i) => (
              <Fragment key={group.slot}>
                {i > 0 && ' · '}
                <b>{slotLabel(group.slot, human)}</b>{' '}
                {group.units.map((u) => unitType(u.typeId).name).join(', ')}
              </Fragment>
            ))}
          </p>
        )}

        <div className="choices">
          {chosen.length > 0 ? (
            (['p1_home', 'frontier', 'p2_home'] as TerrainSlot[]).map((slot) => (
              <button
                key={slot}
                type="button"
                className="choice"
                onClick={() => {
                  onStage(chosen.map((unitId) => ({ unitId, slot })))
                  onClearSelection()
                }}
              >
                To {slotLabel(slot, human)}
              </button>
            ))
          ) : plan.moves.length > 0 ? (
            <button
              type="button"
              className="choice"
              onClick={() => {
                dispatch({ kind: 'reinforce', moves: plan.moves })
                onClearSelection()
              }}
            >
              Send {plan.moves.length}
            </button>
          ) : (
            <button
              type="button"
              className="choice"
              onClick={() => dispatch({ kind: 'reinforce', moves: [] })}
            >
              Leave them in reserve
            </button>
          )}
          {(chosen.length > 0 || plan.moves.length > 0) && (
            <button type="button" className="choice secondary" onClick={onClearDraft}>
              Clear
            </button>
          )}
        </div>
      </div>
    )
  }

  if (prompt.custom === 'retreat') {

    const movable = livingUnits(state, human).filter((u) => u.location.kind === 'terrain')
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
            // The glyphs inside reach a screen reader as nothing, so the whole
            // sentence is repeated here in words.
            aria-label={plainLabel(choice)}
            onClick={() => {
              dispatch(choice.action)
            }}
          >
            <ChoiceLabel label={choice.label} faces={choice.faces ?? []} />
          </button>
        ))}
      </div>
    </div>
  )
}

const ACTION_GLYPH: Record<string, GlyphName> = {
  MELEE: 'MELEE',
  MISSILE: 'MISSILE',
  MAGIC: 'MAGIC',
}

/**
 * One terrain face inside a button.
 *
 * The real art, not our glyph, and this is the one place that is worth the extra
 * pixels: a terrain die has the *number* drawn into it as well as the action icon,
 * and the number is half of what the button is telling you -- "go to face 4" rather
 * than "go to a missile face somewhere". Without the art there is nothing that says
 * both, so the fallback draws them side by side.
 */
function ChoiceFace({ hint }: { hint: FaceHint }) {
  const art = useFaceArt()
  const die = terrainDie(hint.dieId)
  const label = describeFace(hint)

  const url =
    hint.face === 8 ? art.eighthFace(die.eighthFace) : art.terrainFace(die.type, hint.face)
  if (url !== null) {
    return <img className="choice-face" src={url} width={28} height={28} alt={label} title={label} />
  }

  if (hint.face === 8) return <b>{die.eighthFace.replace(/_/g, ' ')}</b>
  const icon = terrainFaceAction(hint.dieId, hint.face as TerrainFaceNumber)
  return (
    <span className="inline-glyph" title={label}>
      <b>{hint.face}</b>
      <Glyph name={ACTION_GLYPH[icon] ?? 'MELEE'} size={16} />
    </span>
  )
}

/**
 * A choice's label with its terrain faces drawn into it.
 *
 * `label` is a template -- "No (stays at {})" -- and each `{}` takes the next hint,
 * so the sentence in `prompts.ts` reads as the one the player sees and that file
 * stays free of JSX.
 */
function ChoiceLabel({ label, faces }: { label: string; faces: readonly FaceHint[] }) {
  return (
    <>
      {label.split('{}').map((text, i) => {
        const hint = faces[i]
        return (
          // A fragment, not a span: the face is a block-level image, so the text
          // around it has to stay in ordinary flow or "(go to" and ")" land on
          // separate lines.
          <Fragment key={i}>
            {text}
            {hint !== undefined && <ChoiceFace hint={hint} />}
          </Fragment>
        )
      })}
    </>
  )
}
