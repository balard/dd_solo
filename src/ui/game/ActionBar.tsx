/**
 * What the game is waiting for, and the only legal ways to answer it.
 *
 * Rendered entirely from `state.pending` via `promptFor`, so this component never
 * decides what is legal and never tracks where it is in a multi-step move -- the
 * engine already knows both. The one piece of local state is the damage selection,
 * which is a draft answer rather than wizard position.
 */
import { Fragment } from 'react'

import { dragonName, terrainDie, terrainFaceAction, unitType } from '../../data/load'
import { spell } from '../../data/spells'

import type { Element, ResultType, TerrainFaceNumber } from '../../data/types'

import { DRAGON_ROLL_KINDS, SAI_TEXT } from '../../engine/sai'
import { ABILITY_TEXT } from '../../engine/species'
import {
  armyRefOf,
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
  breathSelection,
  damageSelection,
  moveDraft,
  growthDraft,
  pickableIn,
  rollsBehind,
  selectModeFor,
  tableRollHeading,
  promoteDraft,
  saiTargetSelection,
  describeFace,
  plainLabel,
  promptFor,
  reinforcePlan,
  retreatPlan,
  slotLabel,
  spellTargetLabel,
  type FaceHint,
  type ReinforceMove,
} from './prompts'
import {
  OWN_ARMY_NOTE,
  repeatBuysNothing,
  spellPlan,
  type SpellAim,
  type SpellDraftCast,
  type SpellTargetOffer,
} from '../../engine/magic'

import { LogLine } from './LogPanel'
import { useFaceArt } from './useFaceArt'

/**
 * The bottom of the screen: the roll behind the decision, then the decision (Phase 9d).
 *
 * The rolls sit *above* every sheet rather than inside some of them. Before this only
 * the targeting sheets drew one strip, and a player assigning damage, or watching the
 * enemy choose a Flame's victims, saw no dice at all. It is also shown while the enemy
 * is deciding, which is when a Confuse is chosen against you.
 */
export function ActionBar(props: {

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
  /** The dragon sheets' draft: a tally under composite keys. */
  counters: Readonly<Record<string, number>>
  /** The spell picker's draft: every cast staged so far. */
  casts: readonly SpellDraftCast[]
  /** Which spell is being aimed, between the two taps an announcement takes. */
  aiming: SpellAim | null
  onAim: (aim: SpellAim | null) => void
  onCast: (cast: SpellDraftCast) => void
  onStage: (moves: readonly ReinforceMove[]) => void
  onPair: (pair: PromotionPair) => void
  onCount: (key: string, by: number) => void
  /** The same toggle the board's grids use, so a die picked in either place is the
   *  one selection. */
  onToggle: (id: UnitId) => void
  onClearSelection: () => void
  /** Clear is not "unselect": mid-reinforce it has to drop the staged moves too. */
  onClearDraft: () => void

  dispatch: (action: GameAction) => void

  /** "Look at dice" (Phase 9e): taps inspect rather than select, draft kept. */
  looking: boolean
  onLook: (looking: boolean) => void
  /** Opens the floating inspector on a die -- from a strip here, or anywhere. */
  onInspect: (id: UnitId | null) => void
}) {
  const { state, human, pending, selection, onToggle, looking, onLook, onInspect, ...rest } = props
  const options = state.winner === null ? pickableIn(pending, state) : null
  const pick =
    options === null || pending?.player !== human || looking
      ? undefined
      : { options: options as ReadonlySet<string>, selected: selection as ReadonlySet<string>, onToggle }
  // Offered whenever the answer is dice -- on the board, in the DUA or in a strip --
  // because that is exactly when a tap on a die cannot also open it.
  const picksDice = pending?.player === human && (selectModeFor(pending, human) !== null || options !== null)

  return (
    <div className="action-dock">
      {state.winner === null && (
        <RollsBehindBlock
          state={state}
          human={human}
          pending={pending}
          pick={pick}
          onInspect={(id) => onInspect(id)}
        />
      )}
      {state.winner === null && picksDice && (
        <div className={`look-toggle ${looking ? 'is-looking' : ''}`}>
          <button type="button" className="choice secondary minor" onClick={() => onLook(!looking)}>
            {looking ? 'Back to choosing' : 'Look at dice'}
          </button>
          {looking && (
            <span className="muted">
              tap any die to see its faces — your picks so far are kept
            </span>
          )}
        </div>
      )}
      {!looking && (
        <Sheet
          {...rest}
          state={state}
          human={human}
          pending={pending}
          selection={selection}
          onToggle={onToggle}
        />
      )}
    </div>
  )
}

function RollsBehindBlock({
  state,
  human,
  pending,
  pick,
  onInspect,
}: {
  state: GameState
  human: PlayerId
  pending: Pending | null
  pick:
    | {
        readonly options: ReadonlySet<string>
        readonly selected: ReadonlySet<string>
        readonly onToggle: (unitId: string) => void
      }
    | undefined
  onInspect: (unitId: string) => void
}) {
  const behind = rollsBehind(state, pending)
  if (behind === null) return null

  return (
    <div className="rolls-behind">
      {behind.kind === 'live'
        ? behind.rolls.map((roll, i) => (
            <div className="sai-roll" key={i}>
              <div className="roll-head">{tableRollHeading(roll, human)}</div>
              <RollStrip
                dice={roll.roll.dice}
                {...(roll.roll.total === undefined ? {} : { total: roll.roll.total })}
                {...(roll.roll.math === undefined ? {} : { math: roll.roll.math })}
                {...(pick === undefined ? {} : { pick })}
                onInspect={onInspect}
              />
            </div>
          ))
        : behind.entries.map((entry, i) => (
            <LogLine key={i} entry={entry} state={state} human={human} />
          ))}
    </div>
  )
}

function Sheet({
  state,
  human,
  pending,
  opponentThinking,
  selection,
  staged,
  pairs,
  counters,
  casts,
  aiming,
  onAim,
  onCast,
  onStage,
  onPair,
  onCount,
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
  /** The dragon sheets' draft: a tally under composite keys. */
  counters: Readonly<Record<string, number>>
  /** The spell picker's draft: every cast staged so far. */
  casts: readonly SpellDraftCast[]
  /** Which spell is being aimed, between the two taps an announcement takes. */
  aiming: SpellAim | null
  onAim: (aim: SpellAim | null) => void
  onCast: (cast: SpellDraftCast) => void
  onStage: (moves: readonly ReinforceMove[]) => void
  onPair: (pair: PromotionPair) => void
  onCount: (key: string, by: number) => void
  /** The same toggle the board's grids use, so a die picked in either place is the
   *  one selection. */
  onToggle: (id: UnitId) => void
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
   * A breath: five health-worth of your own army, chosen by you, maximally.
   *
   * The damage sheet again, and deliberately so -- it is the same rule with a
   * different reason, so it gets the same grid and the same confirm gate rather
   * than a second way of asking one question.
   */
  if (prompt.custom === 'dragon_breath' && pending.kind === 'dragon_breath') {
    const { absorbed, required, ready, suggestion } = breathSelection(state, pending, selection)

    return (
      <div className="action-bar">
        <p className="question">{prompt.question}</p>
        <p className={`tally ${ready ? 'is-ready' : ''}`}>
          absorbed <b>{absorbed}</b> / must reach <b>{required}</b>
        </p>
        <div className="choices">
          <button
            type="button"
            className="choice"
            disabled={!ready}
            onClick={() => {
              dispatch({ kind: 'dragon_breath', unitIds: [...selection] })
              onClearSelection()
            }}
          >
            Confirm losses
          </button>
          <button
            type="button"
            className="choice secondary"
            onClick={() => {
              dispatch({ kind: 'dragon_breath', unitIds: suggestion })
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
   * The combination roll's allocation: what each ID becomes, and how a Create
   * Fireminions splits.
   *
   * Two pools over the same three buckets, so one counter row each. The confirm
   * gate is "spent exactly", which is `allocateIds`' own rule -- the engine would
   * refuse anything else, and a disabled button with the tally beside it says why
   * before the click rather than after.
   */
  if (prompt.custom === 'dragon_allocate' && pending.kind === 'dragon_allocate') {
    const pools = [
      { key: 'ids', label: 'ID results', total: pending.ids },
      { key: 'flexible', label: 'Create Fireminions', total: pending.flexible },
    ].filter((pool) => pool.total > 0)

    const spent = (poolKey: string) =>
      DRAGON_ROLL_KINDS.reduce((sum, kind) => sum + (counters[`${poolKey}.${kind}`] ?? 0), 0)
    const ready = pools.every((pool) => spent(pool.key) === pool.total)

    const build = (poolKey: string) => {
      const out: Partial<Record<ResultType, number>> = {}
      for (const kind of DRAGON_ROLL_KINDS) {
        const n = counters[`${poolKey}.${kind}`] ?? 0
        if (n > 0) out[kind] = n
      }
      return out
    }

    // Flaming Shields (Phase 8): up to this many rolled saves may become melee. Not a
    // pool that must be spent -- "may" -- so it never gates the confirm button.
    const shields = pending.shields ?? 0
    const converted = counters['shields'] ?? 0

    return (
      <div className="action-bar">
        <p className="question">{prompt.question}</p>
        {/* The roll itself is above the sheet (Phase 9d): how many IDs there are to
            spend is the decision, and which dice already gave melee or saves is what
            decides where they go. */}
        {pools.map((pool) => (
          <Fragment key={pool.key}>
            <p className={`tally ${spent(pool.key) === pool.total ? 'is-ready' : ''}`}>
              {pool.label}: spent <b>{spent(pool.key)}</b> / <b>{pool.total}</b>
            </p>
            <div className="choices">
              {DRAGON_ROLL_KINDS.map((kind) => (
                <Fragment key={kind}>
                  <button
                    type="button"
                    className="choice secondary"
                    disabled={(counters[`${pool.key}.${kind}`] ?? 0) === 0}
                    onClick={() => onCount(`${pool.key}.${kind}`, -1)}
                  >
                    −
                  </button>
                  <span className="tally">
                    {kind} <b>{counters[`${pool.key}.${kind}`] ?? 0}</b>
                  </span>
                  <button
                    type="button"
                    className="choice secondary"
                    disabled={spent(pool.key) >= pool.total}
                    onClick={() => onCount(`${pool.key}.${kind}`, 1)}
                  >
                    +
                  </button>
                </Fragment>
              ))}
            </div>
          </Fragment>
        ))}
        {shields > 0 && (
          <>
            <p className="tally">
              <b>Flaming Shields</b>: saves counted as melee <b>{converted}</b> / <b>{shields}</b>
            </p>
            <div className="choices">
              <button
                type="button"
                className="choice secondary"
                disabled={converted === 0}
                onClick={() => onCount('shields', -1)}
              >
                −
              </button>
              <span className="tally">
                save → melee <b>{converted}</b>
              </span>
              <button
                type="button"
                className="choice secondary"
                disabled={converted >= shields}
                onClick={() => onCount('shields', 1)}
              >
                +
              </button>
            </div>
          </>
        )}
        <div className="choices">
          <button
            type="button"
            className="choice"
            disabled={!ready}
            onClick={() => {
              dispatch({
                kind: 'dragon_allocate',
                ids: build('ids'),
                flexible: build('flexible'),
                ...(converted > 0 ? { savesAsMelee: converted } : {}),
              })
              onClearDraft()
            }}
          >
            Confirm the roll
          </button>
          <button type="button" className="choice secondary" onClick={onClearDraft}>
            Clear
          </button>
        </div>
      </div>
    )
  }

  /**
   * Spending melee and missile on the attacking dragons.
   *
   * Never a forced maximum, unlike every damage decision before it: the rules say
   * a player *may* allocate, and results that cannot reach a threshold buy nothing
   * wherever they go. So the confirm button is always live and the sheet just says
   * which dragons the current split would actually kill.
   */
  if (prompt.custom === 'dragon_damage_split' && pending.kind === 'dragon_damage_split') {
    const left = (type: 'melee' | 'missile') =>
      (type === 'melee' ? pending.melee : pending.missile) -
      pending.targets.reduce((sum, t) => sum + (counters[`${type}.${t.dragonId}`] ?? 0), 0)

    const build = (type: 'melee' | 'missile') => {
      const out: Record<string, number> = {}
      for (const target of pending.targets) {
        const n = counters[`${type}.${target.dragonId}`] ?? 0
        if (n > 0) out[target.dragonId] = n
      }
      return out
    }

    return (
      <div className="action-bar">
        <p className="question">{prompt.question}</p>
        <p className="tally">
          left: <b>{left('melee')}</b> melee, <b>{left('missile')}</b> missile
        </p>
        {pending.targets.map((target) => {
          const dragon = state.dragons[target.dragonId]
          const dying = (['melee', 'missile'] as const).some(
            (type) => (counters[`${type}.${target.dragonId}`] ?? 0) >= target.threshold,
          )
          return (
            <Fragment key={target.dragonId}>
              <p className={`tally ${dying ? 'is-ready' : ''}`}>
                {dragon === undefined ? target.dragonId : dragonName(dragon.dieId)} — needs{' '}
                <b>{target.threshold}</b> of one type{dying ? ' — dies' : ''}
              </p>
              <div className="choices">
                {(['melee', 'missile'] as const).map((type) => (
                  <Fragment key={type}>
                    <button
                      type="button"
                      className="choice secondary"
                      disabled={(counters[`${type}.${target.dragonId}`] ?? 0) === 0}
                      onClick={() => onCount(`${type}.${target.dragonId}`, -1)}
                    >
                      −
                    </button>
                    <span className="tally">
                      {type} <b>{counters[`${type}.${target.dragonId}`] ?? 0}</b>
                    </span>
                    <button
                      type="button"
                      className="choice secondary"
                      disabled={left(type) === 0}
                      onClick={() => onCount(`${type}.${target.dragonId}`, 1)}
                    >
                      +
                    </button>
                  </Fragment>
                ))}
              </div>
            </Fragment>
          )
        })}
        <div className="choices">
          <button
            type="button"
            className="choice"
            onClick={() => {
              dispatch({
                kind: 'dragon_damage_split',
                melee: build('melee'),
                missile: build('missile'),
              })
              onClearDraft()
            }}
          >
            Confirm
          </button>
          <button type="button" className="choice secondary" onClick={onClearDraft}>
            Clear
          </button>
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
/**
 * A spell's targets, split into the armies they stand in.
 *
 * Only unit targets group: an army or a terrain target already names its own place,
 * so grouping those would add a heading that repeats the button under it. `head` is
 * null for the ungrouped case, which is most spells.
 */
function targetGroups(
  state: GameState,
  human: PlayerId,
  targets: readonly SpellTargetOffer[],
): readonly { readonly head: string | null; readonly aims: readonly SpellTargetOffer[] }[] {
  if (!targets.every((aim) => aim.target.kind === 'units')) return [{ head: null, aims: targets }]

  const groups = new Map<string, SpellTargetOffer[]>()
  for (const aim of targets) {
    const ids = aim.target.kind === 'units' ? aim.target.unitIds : []
    const ref = ids.map((id) => armyRefOf(state, id)).find((r) => r !== null) ?? null
    // A unit that is nowhere on the board is in the DUA -- Resurrect Dead's targets.
    const head = ref === null ? 'your dead' : slotLabel(ref, human)
    const at = groups.get(head)
    if (at === undefined) groups.set(head, [aim])
    else at.push(aim)
  }

  // One group is no grouping: a heading over the whole list says nothing.
  if (groups.size < 2) return [{ head: null, aims: targets }]
  return [...groups].map(([head, aims]) => ({ head, aims }))
}

function SaiHeader({
  sai,
  rule,
}: {
  state?: GameState
  sai?: string
  rule?: string
}) {
  // The roll itself is drawn above the sheet by `RollsBehindBlock` (Phase 9d), with the
  // roll it came from beside it -- this is the rule, in the book's words.
  // A spell's sentence lives in `data/spells.json` rather than in `SAI_TEXT`, so a
  // caller that already has one hands it over.
  const text = rule ?? (sai === undefined ? undefined : SAI_TEXT[sai])
  return text === undefined ? null : <p className="sai-text">{text}</p>
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
   * Accelerated Growth (Phase 9b): every die in this answer is in the DUA, so every one of
   * them is tapped there -- the dying dice to save and the small ones to bring back. The
   * sheet only counts and confirms; which pairs with which is not a choice worth asking.
   */
  if (prompt.custom === 'accelerated_growth' && pending.kind === 'accelerated_growth') {
    const draft = growthDraft(pending, selection)
    const saving = draft.saving.length
    const bringing = draft.bringing.length
    const most = Math.min(pending.dying.length, pending.partners.length)

    return (
      <div className="action-bar">
        <p className="question">{prompt.question}</p>

        <div className="choices">
          <button
            type="button"
            className={saving > 0 ? 'choice' : 'choice secondary'}
            disabled={draft.pairs === null}
            onClick={() => {
              if (draft.pairs === null) return
              dispatch({ kind: 'accelerated_growth', pairs: draft.pairs })
              onClearDraft()
            }}
          >
            {saving === 0
              ? pending.dying.length === 1
                ? 'Let it die'
                : 'Let them all die'
              : `Exchange ${saving}` +
                (pending.dying.length > saving ? `, let ${pending.dying.length - saving} die` : '')}
          </button>
          <span className="tally muted">
            {saving === 0 && bringing === 0
              ? `in the Fallen area, tap up to ${most} dying ${most === 1 ? 'die' : 'dice'} and as many small ones to bring back`
              : `saving ${saving}, bringing back ${bringing}` +
                (draft.pairs === null ? ' — the two must match' : '')}
          </span>
          {(saving > 0 || bringing > 0) && (
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

  if (prompt.custom === 'announce_spells' && pending.kind === 'announce_spells') {
    // "Once you have decided which spells to cast, announce all of the spells you are
    // casting and each of their targets" (p. 13). So every button stages and one
    // action reaches the engine -- the Reinforce Step's shape, for the Reinforce
    // Step's reason: dispatching per spell would leak the resolution order into the
    // announcement, which the rules choose separately and afterwards.
    const plan = spellPlan(pending.castable, pending.pool, casts)
    const aimed = plan.offers.find((o) => o.castable.spell.id === aiming?.spell)
    // An Elemental spell takes any one of the caster's elements, so which one paid is
    // a real question. Every other spell has exactly one, and is not asked.
    const element = aiming?.element ?? (aimed?.castable.elements.length === 1
      ? (aimed.castable.elements[0] as Element)
      : undefined)

    return (
      <div className="action-bar">
        <p className="question">
          {prompt.question}
          <span className="muted">
            {aimed === undefined
              ? plan.spent > 0
                ? ` — ${plan.remaining} left`
                : ' — pick a spell'
              : element === undefined
                ? ` — pay for ${aimed.castable.spell.name} with which element?`
                : ` — aim ${aimed.castable.spell.name} where?`}
          </span>
        </p>

        {plan.casts.length > 0 && (
          <p className="staged muted">
            {plan.casts.map((cast, i) => (
              <Fragment key={`${cast.spell}:${i}`}>
                {i > 0 && ' · '}
                <b>{spell(cast.spell).name}</b>
                {cast.count > 1 ? ` ×${cast.count}` : ''} at{' '}
                {spellTargetLabel(cast.target, human, state)}
              </Fragment>
            ))}
          </p>
        )}

        {aimed !== undefined && <p className="rule-text muted">{aimed.castable.spell.text}</p>}
        {/* The text is the rulebook's, verbatim, and says "any army"; the buttons below
            say otherwise, so the difference is named rather than left to look like a bug. */}
        {aimed !== undefined && aimed.castable.spell.target === 'own_army' && (
          <p className="rule-text muted">{OWN_ARMY_NOTE}</p>
        )}

        <div className="choices">
          {aimed !== undefined && element === undefined ? (
            <>
              {aimed.castable.elements.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="choice"
                  onClick={() => onAim({ spell: aimed.castable.spell.id, element: e })}
                >
                  {e}
                </button>
              ))}
              <button type="button" className="choice secondary" onClick={() => onAim(null)}>
                Back
              </button>
            </>
          ) : aimed !== undefined && element !== undefined ? (
            <>
              {/*
               * Grouped by the army the targets stand in, not one flat list. A spell
               * that targets units offers one button per unit, and a force fields
               * several dice of one type -- so Mirage in a monster mirror printed
               * "Genie" twelve times over. The heading says which army, and the
               * label says it again on each button, because a button read aloud on
               * its own still has to identify what it picks.
               */}
              {targetGroups(state, human, aimed.castable.targets).map((group) => (
                <Fragment key={group.head ?? 'all'}>
                  {group.head !== null && <p className="choice-group">{group.head}</p>}
                  {group.aims.map((aim, i) => (
                    <button
                      key={i}
                      type="button"
                      className="choice"
                      disabled={
                        aim.minCount * aimed.castable.spell.cost > plan.remaining ||
                        repeatBuysNothing(plan.casts, aimed.castable.spell.id, aim.target)
                      }
                      onClick={() => {
                        onCast({
                          spell: aimed.castable.spell.id,
                          element,
                          // The target sets the floor: Resurrect Dead's price is a
                          // property of what it is aimed at, not a separate choice.
                          count: aim.minCount,
                          target: aim.target,
                        })
                        onAim(null)
                      }}
                    >
                      {spellTargetLabel(aim.target, human, state)}
                      {aim.minCount > 1 && (
                        <span className="muted"> {aim.minCount * aimed.castable.spell.cost}</span>
                      )}
                    </button>
                  ))}
                </Fragment>
              ))}
              <button type="button" className="choice secondary" onClick={() => onAim(null)}>
                Back
              </button>
            </>
          ) : (
            <>
              {plan.offers.map((offer) => (
                <button
                  key={offer.castable.spell.id}
                  type="button"
                  className="choice"
                  disabled={offer.affordable < 1}
                  title={offer.castable.spell.text}
                  onClick={() => onAim({ spell: offer.castable.spell.id })}
                >
                  {offer.castable.spell.name}{' '}
                  <span className="muted">
                    {offer.castable.spell.cost} {offer.castable.elements.join('/')}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className={plan.casts.length > 0 ? 'choice' : 'choice secondary'}
                onClick={() => dispatch({ kind: 'announce_spells', casts: plan.casts })}
              >
                {/* "1 spell" beside a staged "Stone Skin x2" is the rules' own
                    arithmetic: combined castings are one spell with a bigger number,
                    not two spells. A bare "Cast 1" read as though the second casting
                    had been dropped. */}
                {plan.casts.length > 0
                  ? `Cast ${plan.casts.length} spell${plan.casts.length === 1 ? '' : 's'}`
                  : 'Cast nothing'}
              </button>
              {plan.casts.length > 0 && (
                <button type="button" className="choice secondary" onClick={onClearDraft}>
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  if (prompt.custom === 'flashfire' && pending.kind === 'flashfire') {
    // Your own dice, chosen from the grid -- the same gesture damage assignment and
    // retreat use, because the answer is a set of units and that is what the grid is.
    const chosen = [...selection].filter((id) => pending.options.includes(id))
    const over = chosen.length > pending.budget

    return (
      <div className="action-bar">
        <p className="question">
          {prompt.question}
          <span className="muted">
            {' '}
            — tap the dice you want back
            {chosen.length > 0 ? ` (${chosen.length} of ${pending.budget})` : ''}
          </span>
        </p>
        {/* The dice are tappable *here*, not only on the board. The sheet says "tap
            the dice" directly above a picture of them, and answering used to mean
            scrolling back up to the army -- which reads as there being no answer. */}
        <SaiHeader
          state={state}
          rule={spell('flashfire').text}
        />
        <div className="choices">
          <button
            type="button"
            className={chosen.length === 0 ? 'choice secondary' : 'choice'}
            disabled={over}
            onClick={() => {
              dispatch({ kind: 'flashfire', unitIds: chosen })
              onClearSelection()
            }}
          >
            {chosen.length === 0 ? 'Keep them' : `Throw ${chosen.length} again`}
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

  // Rapid Growth (Phase 8): Flashfire's sheet with no budget -- every die that did not
  // roll an SAI may go again, "selected and re-rolled together".
  if (prompt.custom === 'rapid_growth' && pending.kind === 'rapid_growth') {
    const chosen = [...selection].filter((id) => pending.options.includes(id))

    return (
      <div className="action-bar">
        <p className="question">
          {prompt.question}
          <span className="muted"> — tap the dice to throw again, all at once</span>
        </p>
        <SaiHeader
          state={state}
          rule={ABILITY_TEXT['Rapid Growth']}
        />
        <div className="choices">
          <button
            type="button"
            className={chosen.length === 0 ? 'choice secondary' : 'choice'}
            onClick={() => {
              dispatch({ kind: 'rapid_growth', unitIds: chosen })
              onClearSelection()
            }}
          >
            {chosen.length === 0 ? 'Keep the roll' : `Throw ${chosen.length} again`}
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

  if (prompt.custom === 'retreat' && pending.kind === 'retreat') {
    // Air Flight (Phase 8) makes this a draft, the Reinforce Step's shape: "Fly to"
    // stages the chosen dice, and one action still reaches the engine. With nothing
    // able to fly the fly buttons never appear and the sheet is the one it always was.
    const plan = retreatPlan(state, pending, selection, staged)
    const chosen = plan.retreats
    const flying = plan.flights.length

    return (
      <div className="action-bar">
        <p className="question">
          {prompt.question}
          <span className="muted">
            {' '}
            — tap units below{chosen.length > 0 ? ` (${chosen.length} chosen)` : ''}
            {(pending.flights ?? []).length > 0 &&
              (chosen.length > 0 && plan.flyTo.length === 0
                ? '; not all of these can fly, so they can only pull back'
                : ', then pull them back or fly them')}
          </span>
        </p>
        {flying > 0 && (
          <p className="staged muted">
            <b>Air Flight</b>{' '}
            {plan.flights
              .map((move) => `${nameOf(state, move.unitId)} → ${slotLabel(move.slot, human)}`)
              .join(', ')}
          </p>
        )}
        <div className="choices">
          {plan.flyTo.map((slot) => (
            <button
              key={slot}
              type="button"
              className="choice secondary"
              onClick={() => {
                onStage(chosen.map((unitId) => ({ unitId, slot })))
                onClearSelection()
              }}
            >
              Fly {chosen.length} to {slotLabel(slot, human)}
            </button>
          ))}
          <button
            type="button"
            className="choice"
            onClick={() => {
              dispatch({
                kind: 'retreat',
                unitIds: chosen,
                ...(flying > 0 ? { flights: plan.flights } : {}),
              })
              onClearDraft()
            }}
          >
            {chosen.length === 0
              ? flying === 0
                ? 'Keep everyone deployed'
                : `Fly ${flying}, pull back none`
              : flying === 0
                ? `Pull back ${chosen.length}`
                : `Pull back ${chosen.length}, fly ${flying}`}
          </button>
          {(chosen.length > 0 || flying > 0) && (
            <button type="button" className="choice secondary" onClick={onClearDraft}>
              Clear
            </button>
          )}
        </div>
      </div>
    )
  }

  /**
   * City (Phase 5e): one unit, recruited or promoted, or neither. Every button
   * dispatches on the spot -- unlike Wild Growth's sheet, there is no budget to
   * spend across several dice and no partner to pick afterwards, so there is
   * nothing for a draft to hold.
   */
  if (prompt.custom === 'eighth_face_city' && pending.kind === 'eighth_face_city') {
    return (
      <div className="action-bar">
        <p className="question">{prompt.question}</p>
        <div className="choices">
          {pending.recruits.map((unitId) => (
            <button
              key={unitId}
              type="button"
              className="choice"
              onClick={() =>
                dispatch({ kind: 'eighth_face_city', choice: { kind: 'recruit', unitId } })
              }
            >
              Recruit {nameOf(state, unitId)}
            </button>
          ))}
          {pending.promotions.map((pair) => (
            <button
              key={`${pair.unitId}-${pair.partnerId}`}
              type="button"
              className="choice"
              onClick={() => dispatch({ kind: 'eighth_face_city', choice: { kind: 'promote', pair } })}
            >
              Promote {nameOf(state, pair.unitId)} &rarr; {nameOf(state, pair.partnerId)}
            </button>
          ))}
          <button
            type="button"
            className="choice secondary"
            onClick={() => dispatch({ kind: 'eighth_face_city', choice: null })}
          >
            Do nothing
          </button>
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
