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

import { rollOnTheTable } from '../../engine/turn'
import { SAI_TEXT } from '../../engine/sai'
import {
  livingUnits,
  type GameAction,
  type GameState,
  type Pending,
  type PlayerId,
  type PromotionPair,
  type TerrainSlot,
  type UnitId,
} from '../../engine/types'

import { RollStrip } from './DiceGrid'
import { Glyph, type GlyphName } from './Glyph'

/** A unit's name by id, for the sheets that carry ids rather than units. */
const nameOf = (state: GameState, id: UnitId): string => {
  const unit = state.units[id]
  return unit === undefined ? id : unitType(unit.typeId).name
}

import {
  damageSelection,
  moveDraft,
  promoteDraft,
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
  pairs,
  onStage,
  onPair,
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
  /** The Wild Growth draft: which of your dice are growing into which of your dead.
   *  A second draft rather than a wider one -- they answer different questions and
   *  are never both live. */
  pairs: readonly PromotionPair[]
  onStage: (moves: readonly ReinforceMove[]) => void
  onPair: (pair: PromotionPair) => void
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
 * What every SAI sheet opens with: the dice that produced it, and the rule.
 *
 * **Roll, then SAIs, then the totals.** That is the order the rules resolve in, and
 * until this existed it was not the order the game showed: the dice reached the log
 * only at `combat_resolved`, long after the decision they caused had been answered.
 * So a player picked a Flame's victims -- or split a Wild Growth -- without being shown
 * the roll that offered it.
 *
 * The rule text comes with them, because the arithmetic in the question ("target 4
 * health-worth") is the part a player can already see, and the part it hides is what
 * happens to the dice afterwards. `SAI_TEXT` lives beside the handlers so the sentence
 * and the behaviour cannot drift.
 */
function SaiHeader({ state, sai }: { state: GameState; sai: string }) {
  const roll = rollOnTheTable(state)
  const text = SAI_TEXT[sai]

  return (
    <>
      {roll !== null && roll.dice.length > 0 && (
        <div className="sai-roll">
          <div className="roll-head">{roll.kind === 'save' ? 'saves' : 'the roll'}</div>
          <RollStrip dice={roll.dice} />
        </div>
      )}
      {text !== undefined && <p className="sai-text">{text}</p>}
    </>
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

        <SaiHeader state={state} sai={pending.sai} />

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

  /**
   * Wild Growth: pick one of your dice, then pick what it comes back as.
   *
   * The reinforce idiom rather than the damage one -- tap a die, then press a button
   * that says where it goes -- because a promotion is a *pair* and both ends are the
   * player's to choose. The partners are buttons rather than a second selectable grid:
   * they are the only legal answers, they carry their own price, and the DUA is
   * already on screen further down the page for anyone who wants to look at it.
   */
  if (prompt.custom === 'sai_promote' && pending.kind === 'sai_promote') {
    const draft = promoteDraft(state, pending, pairs, selection)
    const chosen = [...selection][0]

    return (
      <div className="action-bar">
        <p className="question">
          <b>{pending.sai}</b> — {draft.left} health of promotion left
          <span className="muted">
            {draft.left > 0 &&
              (pending.saveResultsCount
                ? `, or ${draft.left} save results if you stop`
                : ', and no save roll to spend the rest on')}
            {pending.remaining > 1 && ` (${pending.remaining} to place)`}
          </span>
        </p>

        <SaiHeader state={state} sai={pending.sai} />

        {pairs.length > 0 && (
          <p className="staged muted">
            {pairs.map((pair, i) => (
              <Fragment key={pair.unitId}>
                {i > 0 && ' · '}
                {nameOf(state, pair.unitId)} &rarr; <b>{nameOf(state, pair.partnerId)}</b>
              </Fragment>
            ))}
          </p>
        )}

        <div className="choices">
          {draft.partners.length > 0 ? (
            draft.partners.map(({ unit, cost }) => (
              <button
                key={unit.id}
                type="button"
                className="choice"
                onClick={() => {
                  if (chosen !== undefined) onPair({ unitId: chosen, partnerId: unit.id })
                  onClearSelection()
                }}
              >
                &rarr; {unitType(unit.typeId).name}{' '}
                <span className="muted">({cost})</span>
              </button>
            ))
          ) : (
            <>
              <button
                type="button"
                className="choice"
                onClick={() => {
                  dispatch({ kind: 'sai_promote', pairs })
                  onClearDraft()
                }}
              >
                {pairs.length > 0
                  ? `Confirm ${pairs.length} promotion${pairs.length === 1 ? '' : 's'}`
                  : pending.saveResultsCount
                    ? `Take ${draft.saveResults} save results`
                    : 'Promote nothing'}
              </button>
              {draft.growable.length > 0 && (
                <span className="tally muted">
                  {chosen === undefined
                    ? 'tap one of your dice to promote it'
                    : 'that one cannot grow for what is left'}
                </span>
              )}
            </>
          )}
          {(pairs.length > 0 || chosen !== undefined) && (
            <button type="button" className="choice secondary" onClick={onClearDraft}>
              Clear
            </button>
          )}
        </div>
      </div>
    )
  }

  /**
   * Firewalking and Teleport: the mover is fixed, the passengers are optional, and
   * "stay put" is a real answer rather than an empty one.
   */
  if (prompt.custom === 'sai_move' && pending.kind === 'sai_move') {
    const draft = moveDraft(state, pending, selection)
    const passengers = [...selection].filter((id) => id !== pending.unitId)

    return (
      <div className="action-bar">
        <p className="question">
          <b>{pending.sai}</b> — {nameOf(state, pending.unitId)} may walk off
          <span className="muted">
            {' '}
            with up to {pending.health} health-worth
            {pending.remaining > 1 && ` (${pending.remaining} to place)`}
          </span>
        </p>

        <SaiHeader state={state} sai={pending.sai} />

        <p className={`tally ${draft.ready ? 'is-ready' : ''}`}>
          carrying <b>{draft.carried}</b> / up to <b>{draft.limit}</b>
          {draft.stuck.size > 0 && <span className="muted"> — a sleeping die cannot leave</span>}
        </p>

        <div className="choices">
          {pending.options.map((slot) => (
            <button
              key={slot}
              type="button"
              className="choice"
              disabled={!draft.ready}
              onClick={() => {
                dispatch({ kind: 'sai_move', slot, unitIds: passengers })
                onClearSelection()
              }}
            >
              To {slotLabel(slot, human)}
            </button>
          ))}
          <button
            type="button"
            className="choice secondary"
            onClick={() => {
              dispatch({ kind: 'sai_move', slot: null, unitIds: [] })
              onClearSelection()
            }}
          >
            Stay put
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
      {/* Galeforce picks a terrain rather than dice, so it comes through the ordinary
          button path -- but it is still an SAI being chosen in the middle of a roll,
          and it gets the same roll strip and the same rule text as the rest. */}
      {pending.kind === 'sai_target_army' && <SaiHeader state={state} sai={pending.sai} />}
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
