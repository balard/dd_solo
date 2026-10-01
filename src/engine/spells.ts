/**
 * What a spell does, once it has been announced and it is its turn to resolve.
 *
 * Two kinds, and the split is in the data rather than here. A **declarative** spell
 * carries an `effect` block -- modifiers on a target for a duration -- and becomes a
 * Phase 3 `Effect` with no code of its own. A **handled** spell names a function
 * below, which means it does something at resolution time that an `Effect` cannot
 * express: damage, a sub-roll, a move, a trigger.
 *
 * Unlike an SAI, a spell handler **takes `GameState`**. An SAI is a pure function of
 * its face and what the roll is for; a spell moves units, terrains and dragons, and
 * pretending otherwise would put a second dispatch table in `turn.ts` for the half
 * that touches the board. What a handler must *not* do is set `pending`: a spell that
 * owes a decision parks it on `turn.magic`, and `stepMarch` asks -- the same shape a
 * targeting SAI uses.
 *
 * `resolvesSpell` is `resolvesSai`'s and `resolvesIcon`'s twin, for the reason both
 * of those exist: the answer changes by rung, and a table is only ever right about
 * one rung. A spell the rules being played cannot resolve is simply never offered,
 * which is the `sai: 'results'` lesson rather than the `'full'` one -- the throw in
 * `castSpell` guards against a spell reaching resolution anyway, not against
 * half-built work.
 */
import { dragonDie } from '../data/load'
import { spell, type Spell, type SpellEffectSpec, type SpellModifierSpec } from '../data/spells'

import type { Element, ResultType } from '../data/types'

import { healthsOf, maxAbsorbable } from './damage'
import { deathEntries, killUnits } from './death'
import { returnFromDua } from './dua'
import { armyRoll, endGlaresOf, unitRoll, type Effect, type EffectTarget } from './effects'
import { expectNoEffects, rollArmy, rollUnits, type DieRoll } from './roll'
import { ALL_RESULT_TYPES, type Modifier } from './pipeline'

import { damageSubRoll } from './subroll'
import {
  army as armyOf,
  armyRefOf,
  opponentOf,
  TERRAIN_SLOTS,
  type ArmyRef,
  type DragonId,
  type GameState,
  type PlayerId,
  type RuleSet,
  type SpellChoice,
  type SpellTarget,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'

/** What a handler is told about the cast it is resolving. */
export interface SpellContext {
  readonly caster: PlayerId
  /** Where the casting army stands. `'reserve'` once Reserve magic returns (7f). */
  readonly army: ArmyRef
  /** Which element paid. Fixed by the spell unless it is Elemental -- Resurrect Dead
   *  and Summon Dragon are the two that read it. */
  readonly element: Element
  /** Combined castings, folded at announcement. A cumulative spell multiplies its
   *  own highlighted number by this; a non-cumulative one ignores it. */
  readonly count: number
  /** What the caster named at announcement, already checked to still exist. */
  readonly target: SpellTarget
}

/**
 * What a handler did, and what it still needs to be told.
 *
 * A handler cannot raise a `Pending` -- `applyAction` clears `pending` and only
 * `stepGame` sets one -- so a spell that owes a decision hands one back here and the
 * march step asks. `SaiOutcome`'s shape, for `SaiOutcome`'s reason.
 */
export interface SpellOutcome {
  readonly state: GameState
  readonly choice?: SpellChoice
}

type SpellHandler = (state: GameState, ctx: SpellContext) => SpellOutcome

/**
 * One data modifier as the pipeline's, scaled by the number of combined castings.
 *
 * "Multiply the highlighted effect(s) by the number of combined castings" -- three
 * Wind Walks add twelve maneuver results, as **one** effect rather than three. That
 * distinction is not cosmetic: the pipeline caps dividers and multipliers at one per
 * result type, and three separate `divide` effects would throw where one scaled effect
 * would not. No spell in scope divides or multiplies, so nothing exercises that today
 * -- but folding at cast time is the shape that stays right when one does.
 *
 * `'*'` expands to every result type: Ash Storm subtracts from *all* results, and five
 * rows in the data would be five places to get it wrong.
 */
function scaleModifier(m: SpellModifierSpec, count: number): readonly Modifier[] {
  const types: readonly ResultType[] =
    m.resultType === '*' ? ALL_RESULT_TYPES : [m.resultType]

  return types.map((resultType): Modifier => {
    switch (m.kind) {
      case 'add':
        return { kind: 'add', resultType, amount: (m.amount ?? 0) * count }
      case 'subtract':
        return { kind: 'subtract', resultType, amount: (m.amount ?? 0) * count }
      // A cumulative divider or multiplier would scale its *factor*, which is what
      // "multiply the highlighted effect" says. Neither is reachable from the eighteen
      // spells in scope; both are written out rather than thrown on, because the
      // throw would be the interesting case and it belongs in the data check.
      case 'divide':
        return { kind: 'divide', resultType, by: (m.by ?? 1) * count }
      case 'multiply':
        return { kind: 'multiply', resultType, by: (m.by ?? 1) * count, share: m.share ?? 'all' }
      case 'ignore_ids':
        return { kind: 'ignore_ids', resultType }
    }
  })
}

/**
 * Where a declarative spell's effect sits, from its scope and what the caster named.
 *
 * The two questions are deliberately separate: `target` is what the *player* chose at
 * announcement and `scope` is what the *spell* does with it. Ash Storm and Wall of Fog
 * are both "target any terrain" and reach entirely different armies.
 */
function effectTargetFor(scope: SpellEffectSpec['scope'], target: SpellTarget): EffectTarget {
  switch (scope) {
    case 'army':
      if (target.kind !== 'army') throw new Error(`an army spell was aimed at a ${target.kind}`)
      return { kind: 'army', player: target.player, army: target.army }
    case 'unit':
      if (target.kind !== 'units' || target.unitIds[0] === undefined) {
        throw new Error(`a unit spell was aimed at a ${target.kind}`)
      }
      return { kind: 'unit', unitId: target.unitIds[0] }
    case 'all_armies':
    case 'attackers':
      if (target.kind !== 'terrain') throw new Error(`a terrain spell was aimed at a ${target.kind}`)
      return { kind: 'terrain', slot: target.slot, scope }
    case 'maneuverers':
      // Wall of Thorns, Phase 7d. It has no `effect` block yet, so `resolvesSpell` is
      // false for it and nothing can reach this.
      throw new Error(`the ${scope} scope is not implemented yet`)
  }
}

/** The `Effect` a declarative spell becomes. Pure: no board, no randomness. */
export function spellEffect(s: Spell, ctx: SpellContext): Effect {
  const spec = s.effect
  if (spec === undefined) throw new Error(`${s.id} is not a declarative spell`)

  return {
    source: s.name,
    target: effectTargetFor(spec.scope, ctx.target),
    modifiers: spec.modifiers.flatMap((m) => scaleModifier(m, s.cumulative ? ctx.count : 1)),
    // Every spell in scope that lasts at all lasts until the beginning of the caster's
    // next turn, so `duration` has exactly one value and this needs no branch.
    expiresAtStartOfTurnOf: ctx.caster,
  }
}

/**
 * The handled spells.
 *
 * Empty in 7a by design: the slice builds the seam and resolves nothing, so
 * `resolvesSpell` answers false for all eighteen and no announcement can be made.
 * Each later slice moves its spells in here, or gives them an `effect` block in
 * `data/spells.json`.
 */
/**
 * Hailstorm: "inflict one point of damage on the target", multiplied by the castings.
 *
 * Damage, not an effect -- so it goes through the ordinary assignment the defender
 * makes, maximal-subset rule and all. One point usually kills nothing, which is not a
 * special case: damage too small to kill anything is dropped, exactly as it is after
 * a melee exchange.
 *
 * **And the target rolls saves first.** "When a unit takes damage it is permitted to
 * make a save roll unless an effect states otherwise", and "attacks or spells that
 * target an army allow the entire army to make a save roll" (p. 29). Hailstorm's own
 * sentence states nothing otherwise, so the general rule stands -- which is what this
 * shipped without, making it the only damage in the game that no save could touch.
 * Every other saveless number in v1 says so on the face of it: a riposte, Smite's
 * unsavable results, Wall of Thorns' melee roll *instead of* a save roll.
 */
const hailstorm: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'army') throw new Error('Hailstorm targets an army')

  const rolled = spellSaveRoll(state, 'Hailstorm', ctx.target.player, ctx.target.army)
  const damage = Math.max(0, ctx.count - rolled.saves)
  const army = armyOf(rolled.state, ctx.target.player, ctx.target.army)

  if (damage === 0 || maxAbsorbable(healthsOf(army), damage) === 0) return { state: rolled.state }

  return {
    state: rolled.state,
    choice: { kind: 'damage', player: ctx.target.player, army: ctx.target.army, damage },
  }
}

/**
 * The save roll a damaging spell allows its target, and the log line for it.
 *
 * An **army** roll, because the spell targets an army -- so it picks up a Stone Skin,
 * an Ash Storm and the eighth face's ID doubling, all of which the rules mean it to.
 *
 * Two details it shares with Wall of Thorns' roll, for the same reasons:
 *
 *  - the purpose is a **save roll against nothing** (`against: null`), the SAI
 *    reference's "any other save roll" -- so Counter and Volley generate their save
 *    results and no riposte, there being nobody to send one back to;
 *  - `isTrigger` stops Wild Growth and the free moves offering a decision that a
 *    spell resolving mid-list has nowhere to put. A house rule, `RULES-V0.md` §15.
 */
function spellSaveRoll(
  state: GameState,
  source: string,
  player: PlayerId,
  ref: ArmyRef,
): { readonly state: GameState; readonly saves: number } {
  const army = armyRoll(state, player, ref, 'save')
  if (army.units.length === 0) return { state, saves: 0 }

  const [roll, rng] = rollArmy(army.units, 'save', state.rng, state.ruleSet, army.modifiers, {
    purpose: { kind: 'save', against: null },
    isCounter: false,
    isTrigger: true,
  })
  expectNoEffects(roll, `${source}'s save roll`)

  return {
    state: {
      ...{ ...state, rng },
      log: [
        ...state.log,
        {
          kind: 'spell_saves',
          player,
          source,
          slot: ref,
          saves: roll.total,
          dice: roll.dice,
          ...(roll.math !== undefined ? { math: roll.math } : {}),
        },
      ],
    },
    saves: roll.total,
  }
}

/**
 * Path: "move the target to any other terrain where you have an army."
 *
 * The unit is named at announcement and the destination is chosen now, because the
 * destination is the spell's *effect* rather than its target -- the rules announce
 * targets, not outcomes.
 */
const path: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Path targets units')

  const movers = ctx.target.unitIds
    .map((id) => state.units[id])
    .filter((u): u is UnitInstance => u !== undefined && u.location.kind === 'terrain')
  if (movers.length === 0) return { state }

  const here = new Set(
    movers.map((u) => (u.location.kind === 'terrain' ? u.location.slot : null)),
  )
  const options = TERRAIN_SLOTS.filter(
    (slot) => !here.has(slot) && armyOf(state, ctx.caster, slot).length > 0,
  )
  // "Any *other* terrain where you have an army" -- with nowhere to go the spell does
  // nothing, and a decision with no answers is not asked.
  if (options.length === 0) return { state }

  return { state, choice: { kind: 'move', unitIds: movers.map((u) => u.id), options } }
}

/**
 * Resurrect Dead: "target one health-worth of units in your DUA that contains the
 * element of magic used to cast this spell. Return the targets to the casting army."
 *
 * The health budget and the element were both checked at announcement, where the
 * number of castings is known. This moves them.
 */
const resurrectDead: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Resurrect Dead targets units')

  const alive = ctx.target.unitIds.filter((id) => state.units[id]?.location.kind === 'dua')
  if (alive.length === 0) return { state }

  return { state: returnFromDua(state, alive, ctx.army) }
}

/**
 * Summon Dragon: "summon one dragon that contains the element used to cast this spell
 * from any Summoning Pool or terrain to the target terrain."
 *
 * **Any** pool, including the opponent's, and any terrain -- the spell pulls a dragon
 * off the board as readily as out of a pool. What it may not do is fetch an element
 * the magic did not pay for, which is the one thing `ctx.element` is read for.
 */
const summonDragon: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'terrain') throw new Error('Summon Dragon targets a terrain')

  const options = summonable(state, ctx.element, ctx.target.slot)
  if (options.length === 0) return { state }

  return {
    state,
    choice: {
      kind: 'summon',
      slot: ctx.target.slot,
      options,
      remaining: Math.min(ctx.count, options.length),
    },
  }
}

/** Every dragon this element could fetch: the right colour, and not already there. */
export function summonable(
  state: GameState,
  element: Element,
  slot: TerrainSlot,
): readonly DragonId[] {
  return Object.values(state.dragons)
    .filter((d) => dragonDie(d.dieId).element === element)
    .filter((d) => !(d.location.kind === 'terrain' && d.location.slot === slot))
    .map((d) => d.id)
}

/**
 * The roll Mirage and Lightning Strike put their targets through.
 *
 * Exactly Phase 4d's sub-roll, and it reuses it wholesale: a *unit* roll, so it gathers
 * through `unitRoll` and never `armyRoll` -- "modifiers that affect an army do not
 * affect the roll of an individual unit from that army" (p. 28). A die that cannot be
 * rolled generates nothing, which means it fails, and draws no randomness doing it.
 *
 * `isSubRoll` is what tells an SAI this is one die rolling for its life: without it a
 * Firewalking face on a target offers a free move nobody can be asked about, and
 * `expectNoEffects` refuses the roll rather than the effect being quietly dropped.
 */
function saveSubRoll(
  state: GameState,
  source: string,
  unitIds: readonly UnitId[],
): { readonly state: GameState; readonly failed: readonly UnitId[]; readonly dice: readonly DieRoll[] } {
  // Board order, not the order the caster named them -- `death.ts`'s rule, so two
  // players naming the same units differently get the same game.
  const ordered = Object.values(state.units)
    .filter((unit) => unitIds.includes(unit.id))
    .map((unit) => unitRoll(state, unit.id))

  const [rolls, rng] = rollUnits(
    ordered,
    'save',
    { purpose: { kind: 'save', against: null }, isCounter: false, isSubRoll: true },
    state.rng,
    state.ruleSet,
  )

  const failed: UnitId[] = []
  const dice: DieRoll[] = []
  const rolled: UnitId[] = []
  for (const sub of rolls) {
    if (sub.roll === null) {
      failed.push(sub.unitId)
      continue
    }
    expectNoEffects(sub.roll, `${source}'s save roll`)
    dice.push(...sub.roll.dice)
    rolled.push(sub.unitId)
    if (sub.roll.total === 0) failed.push(sub.unitId)
  }

  // A glaring die that rolls ends its glare (v2 Phase 6c). 5b gave that one door, the
  // SAI sub-roll, and these two spells roll their targets through this one instead --
  // so a Leviathan struck by lightning went on glaring. Every unit roll ends it.
  return { state: endGlaresOf({ ...state, rng }, rolled), failed, dice }
}

/** The units a spell named that are still where it named them. */
const stillThere = (state: GameState, ids: readonly UnitId[]): readonly UnitId[] =>
  ids.filter((id) => state.units[id]?.location.kind === 'terrain')

/**
 * Mirage: "the targets make a save roll. Those that do not generate a save result are
 * moved to their Reserve Area."
 *
 * Seize's shape exactly, down to the escapees not being killed -- so no death trigger
 * fires and nothing goes to the DUA.
 */
const mirage: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Mirage targets units')
  const targets = stillThere(state, ctx.target.unitIds)
  if (targets.length === 0) return { state }

  const rolled = saveSubRoll(state, 'Mirage', targets)
  const units = { ...rolled.state.units }
  for (const id of rolled.failed) {
    const unit = units[id]
    if (unit !== undefined) units[id] = { ...unit, location: { kind: 'reserve' } }
  }

  return {
    state: {
      ...rolled.state,
      units,
      log: [
        ...rolled.state.log,
        {
          kind: 'sai_sub_roll',
          player: owners(state, targets),
          source: 'Mirage',
          slot: slotOf(state, targets),
          test: 'save',
          dice: rolled.dice,
          escaped: targets.filter((id) => !rolled.failed.includes(id)),
          ...(rolled.failed.length > 0 ? { toReserve: true as const } : {}),
        },
      ],
    },
  }
}

/**
 * Lightning Strike: "the target makes a save roll. If it does not generate a save
 * result, it is killed."
 *
 * A kill rather than a move, so it goes through `killUnits` and the death trigger
 * fires -- a Phoenix struck by lightning still gets its roll.
 */
const lightningStrike: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Lightning Strike targets a unit')
  const targets = ctx.target.unitIds.filter((id) => state.units[id] !== undefined)
  if (targets.length === 0) return { state }

  const rolled = saveSubRoll(state, 'Lightning Strike', targets)
  const victim = owners(state, targets)
  const where = slotOf(state, targets)

  const logged: GameState = {
    ...rolled.state,
    log: [
      ...rolled.state.log,
      {
        kind: 'sai_sub_roll',
        player: victim,
        source: 'Lightning Strike',
        slot: where,
        test: 'save',
        dice: rolled.dice,
        escaped: targets.filter((id) => !rolled.failed.includes(id)),
      },
    ],
  }

  if (rolled.failed.length === 0) return { state: logged }

  const outcome = killUnits(logged, rolled.failed)
  return {
    state: {
      ...outcome.state,
      log: [
        ...outcome.state.log,
        ...deathEntries(outcome, victim, where, rolled.failed),
      ],
    },
  }
}

/**
 * Firebolt (v2 Phase 6g): "target any opposing unit. Inflict one point of damage on the
 * target." Cumulative -- the "one" is printed in red -- so N castings on one unit are N
 * damage.
 *
 * Damage, so the unit "is permitted to make a save roll" (p. 29), and it is the roll
 * Bash's target makes (`damageSubRoll`, v2 Phase 6b): it dies when its saves leave
 * damage reaching its health. One point never kills a 2-health die, and still rolls --
 * the rules give the save roll before anyone does the sum. Not Lightning Strike's roll,
 * where any save at all escapes.
 */
const firebolt: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Firebolt targets a unit')
  const [target] = ctx.target.unitIds.filter((id) => armyRefOf(state, id) !== null)
  if (target === undefined) return { state }
  return { state: damageSubRoll(state, target, ctx.count, 'Firebolt').state }
}

/**
 * Flash Flood: "reduce that terrain one step unless an opposing army at that terrain
 * generates at least six maneuver results."
 *
 * The defender's roll is an **army** roll, so it goes through `armyRoll` and picks up
 * everything sitting on that army -- an Ash Storm there makes the wall harder to clear.
 * No opposing army means no roll and no randomness: there is nobody to resist.
 *
 * "A terrain may never be reduced by more than one step during a player's turn from
 * the effects of Flash Flood", so a second casting at the same terrain still rolls and
 * still achieves nothing. That is the rule as written, not a shortcut.
 */
const flashFlood: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'terrain') throw new Error('Flash Flood targets a terrain')
  const slot = ctx.target.slot
  const needed = FLASH_FLOOD_RESISTANCE * ctx.count
  const defender = opponentOf(ctx.caster)

  const army = armyRoll(state, defender, slot, 'maneuver')
  let next = state
  let resisted = 0

  if (army.units.length > 0) {
    const [roll, rng] = rollArmy(
      army.units,
      'maneuver',
      state.rng,
      state.ruleSet,
      army.modifiers,
      { purpose: { kind: 'maneuver' }, isCounter: false },
    )
    // A maneuver roll has nowhere to put an effect, exactly as a contest does.
    expectNoEffects(roll, "Flash Flood's maneuver roll")
    resisted = roll.total
    next = { ...state, rng }
  }

  const held = resisted >= needed
  const already = (next.turn.floodedSlots ?? []).includes(slot)
  const face = next.terrains[slot].face

  return {
    state: {
      ...next,
      log: [
        ...next.log,
        {
          kind: 'flash_flood',
          player: ctx.caster,
          slot,
          needed,
          resisted,
          moved: !held && !already && face > 1,
        },
      ],
    },
    ...(held || already || face <= 1 ? {} : { choice: { kind: 'flood', slot } as const }),
  }
}

/**
 * Wall of Thorns: a ward on a terrain that bites an army for maneuvering it.
 *
 * An `Effect` with no modifiers at all -- the damage is not arithmetic on a roll, and
 * the roll the army answers with is a *melee* roll in place of a save roll, which no
 * `Modifier` could express either. Hence `Effect.thorns`, `asleep`'s sibling.
 */
const wallOfThorns: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'terrain') throw new Error('Wall of Thorns targets a terrain')

  return {
    state: {
      ...state,
      effects: [
        ...state.effects,
        {
          source: 'Wall of Thorns',
          target: { kind: 'terrain', slot: ctx.target.slot, scope: 'maneuverers' },
          modifiers: [],
          thorns: WALL_OF_THORNS_DAMAGE * ctx.count,
          expiresAtStartOfTurnOf: ctx.caster,
        },
      ],
      log: [
        ...state.log,
        {
          kind: 'effect_cast',
          player: ctx.caster,
          source: 'Wall of Thorns',
          slot: ctx.target.slot,
        },
      ],
    },
  }
}

/** "...unless an opposing army at that terrain generates at least six maneuver
 *  results", multiplied by the castings. */
export const FLASH_FLOOD_RESISTANCE = 6

/** "...takes six points of damage", multiplied by the castings. */
export const WALL_OF_THORNS_DAMAGE = 6

/** Whose dice these are. They are one army's, so the first answers for all. */
function owners(state: GameState, ids: readonly UnitId[]): PlayerId {
  const first = ids[0] === undefined ? undefined : state.units[ids[0]]
  return first?.owner ?? 'p1'
}

/** Where they stand. Reserves for a unit that is not at a terrain. */
function slotOf(state: GameState, ids: readonly UnitId[]): ArmyRef {
  const first = ids[0] === undefined ? undefined : state.units[ids[0]]
  return first !== undefined && first.location.kind === 'terrain' ? first.location.slot : 'reserve'
}

/**
 * Flashfire: a standing licence to throw one of your own dice again.
 *
 * An `Effect` with no modifiers, like Wall of Thorns -- a reroll is not arithmetic on
 * a roll. `Effect.flashfire` is how many dice it covers, because the cumulative number
 * is "any **one** unit" and two separate castings therefore reach two.
 */
const flashfire: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'army') throw new Error('Flashfire targets an army')

  return {
    state: {
      ...state,
      effects: [
        ...state.effects,
        {
          source: 'Flashfire',
          target: { kind: 'army', player: ctx.target.player, army: ctx.target.army },
          modifiers: [],
          flashfire: ctx.count,
          expiresAtStartOfTurnOf: ctx.caster,
        },
      ],
      log: [
        ...state.log,
        {
          kind: 'effect_cast',
          player: ctx.caster,
          source: 'Flashfire',
          target: ctx.target.player,
          slot: ctx.target.army,
        },
      ],
    },
  }
}

/**
 * Accelerated Growth: a standing licence for your dying Treefolk to swap places with a
 * small one instead.
 *
 * Targets the *player*, not an army or a terrain: "target your DUA", which is neither.
 * `killUnits` reads it; nothing that throws dice does.
 */
const acceleratedGrowth: SpellHandler = (state, ctx) => ({
  state: {
    ...state,
    effects: [
      ...state.effects,
      {
        source: 'Accelerated Growth',
        target: { kind: 'player', player: ctx.caster },
        modifiers: [],
        trigger: 'accelerated_growth',
        expiresAtStartOfTurnOf: ctx.caster,
      },
    ],
    log: [
      ...state.log,
      {
        kind: 'effect_cast',
        player: ctx.caster,
        source: 'Accelerated Growth',
        target: ctx.caster,
        slot: ctx.army,
        onDua: true,
      },
    ],
  },
})

const HANDLERS: Readonly<Record<string, SpellHandler>> = {
  flashfire,
  accelerated_growth: acceleratedGrowth,
  hailstorm,
  path,
  resurrect_dead: resurrectDead,
  summon_dragon: summonDragon,
  mirage,
  lightning_strike: lightningStrike,
  firebolt,
  flash_flood: flashFlood,
  wall_of_thorns: wallOfThorns,
}

/** The spell ids this build can actually resolve, for tests and for the clients. */
export function resolvableSpells(ruleSet: RuleSet): readonly string[] {
  return Object.keys(HANDLERS).filter((id) => resolvesSpell(id, ruleSet))
}

/**
 * Whether this build can resolve this spell under these rules.
 *
 * False for every spell under `magic: 'simplified'`, which is what keeps `V0_RULES`
 * exactly the v0 game. Under `'spells'` it is "the data gave it an effect, or code
 * gave it a handler" -- and a spell with neither is transcribed but not implemented,
 * a real and temporary state that `spells.test.ts` pins the membership of.
 */
export function resolvesSpell(id: string, ruleSet: RuleSet): boolean {
  if (ruleSet.magic !== 'spells') return false
  const s = spell(id)
  return s.effect !== undefined || HANDLERS[s.handler ?? ''] !== undefined
}

/**
 * Resolves one announced cast.
 *
 * Throws for a spell that reached resolution with nothing behind it. That is not the
 * `sai: 'full'` refusal in disguise: `castableSpells` filters on `resolvesSpell`, so
 * an unimplemented spell can never be announced, and this can only fire if something
 * bypassed the offer.
 */
export function castSpell(state: GameState, s: Spell, ctx: SpellContext): SpellOutcome {
  const handler = HANDLERS[s.handler ?? '']
  if (handler !== undefined) return handler(state, ctx)

  throw new Error(`spell ${s.id} has no effect and no handler, and cannot be resolved`)
}
