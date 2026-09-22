/**
 * Dragons: their own roll, who they attack, and what their icons do.
 *
 * The pure half of Phase 6 -- no `GameState` mutation, no pendings -- for the same
 * reason `sai.ts` is pure: every rule here is rulebook prose (full rules pp. 17-20)
 * and prose is best tested from a literal rather than through a game.
 *
 * **A dragon's own roll is not the ten-step pipeline.** A dragon face carries a fixed
 * named ability rather than a count of result icons, so there is no subtotal, no
 * divide and no modifier to apply: you roll one of twelve faces and do what it says.
 * `resolveFaces` and the `{id, normal, sai}` triple have nothing to contribute, and
 * reusing them would mean inventing counts the dice do not print. The army's *answer*
 * is an ordinary roll and does go through the pipeline -- see `DRAGON_ROLL_KINDS`.
 */
import { dragonDie, dragonFaceIcon, dragonName } from '../data/load'
import type { DragonElement, DragonFaceNumber, DragonIcon } from '../data/types'

import { nextInt, type RngState } from './rng'
import {
  TERRAIN_SLOTS,
  armyAt,
  dragonsAt,
  type DragonId,
  type DragonInPlay,
  type GameState,
  type PlayerId,
  type TerrainSlot,
} from './types'

/** Health, and the automatic saves that go with it (p. 17). */
export const DRAGON_HEALTH = 5
export const DRAGON_AUTOMATIC_SAVES = 5

/** What each icon inflicts, in points of damage (p. 20). */
const ICON_DAMAGE: Readonly<Record<DragonIcon, number>> = {
  JAWS: 12,
  CLAW: 6,
  WING: 5,
  TAIL: 3,
  /** Against another dragon only; against an army breath kills health-worth instead. */
  BREATH: 5,
  BELLY: 0,
  TREASURE: 0,
}

/**
 * The icons that say "roll the dragon again and apply the new result as well".
 *
 * Breath is on this list only when the target is another dragon (p. 20): against an
 * army it kills five health-worth and applies its element instead, with no reroll.
 */
const REROLLS_ON: readonly DragonIcon[] = ['TAIL']

/**
 * A dragon can in principle roll tails forever. Bound it rather than spin, the way
 * the Horde roll-off bounds its ties -- a drake has two tail faces of twelve, so
 * reaching this at all is somewhere past astronomically unlikely.
 */
const MAX_DRAGON_REROLLS = 50

/** One face a dragon showed. Rerolls are appended, in throwing order, as in `RawDie`. */
export interface DragonRoll {
  readonly dragonId: DragonId
  /** 1-12, as printed. */
  readonly faceIndex: number
  readonly reroll?: true
}

/** Narrows a rolled 1-12 to the face numbers the data is keyed by. */
function faceNumber(index: number): DragonFaceNumber {
  if (!Number.isInteger(index) || index < 1 || index > 12) {
    throw new Error(`dragon face ${index} is outside 1-12`)
  }
  return index as DragonFaceNumber
}

export const rolledIcon = (state: GameState, roll: DragonRoll): DragonIcon => {
  const dragon = state.dragons[roll.dragonId]
  if (dragon === undefined) throw new Error(`no such dragon ${roll.dragonId}`)
  return dragonFaceIcon(dragon.dieId, faceNumber(roll.faceIndex))
}

/**
 * Rolls one dragon, following its rerolls.
 *
 * Whether a reroll happens depends on the target -- breath rerolls against a dragon
 * and not against an army -- so the target has to be known before the dice are
 * thrown, which is exactly why the rulebook designates targets at step 2 and rolls
 * at step 3.
 */
export function rollDragon(
  dragonId: DragonId,
  dieId: string,
  againstDragon: boolean,
  rng: RngState,
): readonly [readonly DragonRoll[], RngState] {
  const rolls: DragonRoll[] = []
  let state = rng

  for (let n = 0; n < MAX_DRAGON_REROLLS; n++) {
    const [index, next] = nextInt(state, 12)
    state = next
    const faceIndex = index + 1
    rolls.push(n === 0 ? { dragonId, faceIndex } : { dragonId, faceIndex, reroll: true })

    const icon = dragonFaceIcon(dieId, faceNumber(faceIndex))
    const again = REROLLS_ON.includes(icon) || (icon === 'BREATH' && againstDragon)
    if (!again) break
  }

  return [rolls, state] as const
}

/** What one dragon is attacking this phase. */
export type DragonTarget =
  | { readonly kind: 'army'; readonly player: PlayerId }
  | { readonly kind: 'dragon'; readonly dragonId: DragonId }

/**
 * Who each dragon at a terrain attacks (p. 18).
 *
 * The rulebook's table has six dragon kinds; with only Elemental dragons in the game
 * every row but one is unreachable, and it reduces to: **attack another dragon of a
 * different element if one is here, otherwise the marching player's army.** A dragon
 * never attacks its own element, which is the only exclusion the five base elements
 * can produce.
 *
 * **The owner chooses when several are eligible**, which is what `choices` carries and
 * why this returns two maps rather than one. It was unreachable in Phase 6 -- at most
 * one dragon per player could be on the board and nothing summoned another, so no
 * dragon ever had two eligible targets -- and Phase 7c's `Summon Dragon` is what made
 * it real.
 */
export interface DragonTargeting {
  /** Dragons with nothing to decide: one eligible enemy, or none and so the army. */
  readonly settled: ReadonlyMap<DragonId, DragonTarget>
  /** Dragons whose owner must declare, by the dragons they may declare against.
   *  Empty until a terrain can hold more than two dragons, which needs Phase 7c's
   *  `Summon Dragon`. */
  readonly choices: ReadonlyMap<DragonId, readonly DragonId[]>
}

export function dragonTargets(
  state: GameState,
  slot: TerrainSlot,
  marching: PlayerId,
): DragonTargeting {
  const present = dragonsAt(state, slot)
  const settled = new Map<DragonId, DragonTarget>()
  const choices = new Map<DragonId, readonly DragonId[]>()

  for (const dragon of present) {
    // p. 18's six-kind table with every out-of-scope row removed: attack a
    // different-element dragon if one is here, never your own element, otherwise the
    // marching army. Same-element dragons never fight each other.
    const enemies = present.filter(
      (other) => other.id !== dragon.id && elementOf(other) !== elementOf(dragon),
    )

    if (enemies.length === 0) settled.set(dragon.id, { kind: 'army', player: marching })
    else if (enemies.length === 1 && enemies[0] !== undefined) {
      settled.set(dragon.id, { kind: 'dragon', dragonId: enemies[0].id })
    } else choices.set(dragon.id, enemies.map((e) => e.id))
  }

  return { settled, choices }
}

export const elementOf = (dragon: DragonInPlay): DragonElement => dragonDie(dragon.dieId).element

export const nameOf = (dragon: DragonInPlay): string => dragonName(dragon.dieId)

/**
 * Every terrain the Dragon Attack Phase fires at: those where the marching player
 * has an army and at least one dragon is present (p. 17).
 *
 * In board order, which is the order the *pending* offers them in -- the marching
 * player picks, because the rules let them (p. 18) and because Phase 7c's `Summon
 * Dragon` finally makes two qualifying terrains reachable. Phase 6 fixed the order
 * here instead, having no way to put a dragon anywhere but the Frontier.
 */
export function dragonAttackSlots(state: GameState, marching: PlayerId): readonly TerrainSlot[] {
  return TERRAIN_SLOTS.filter(
    (slot) => armyAt(state, marching, slot).length > 0 && dragonsAt(state, slot).length > 0,
  )
}

/** What a set of rolls does to whatever the dragon is attacking. */
export interface DragonAttackTotals {
  /** Jaws, claws, wing and tail, summed. Breath against an army is not here. */
  readonly damage: number
  /** Breath faces against an army: each kills five health-worth and applies its element. */
  readonly breaths: number
  /** Treasure faces against an army: each promotes one unit. */
  readonly treasures: number
  /** Belly: this dragon's own automatic saves do not count in this attack. */
  readonly bellyUp: boolean
  /** Wing: it flies home afterwards, if it is still alive. */
  readonly flies: boolean
}

/**
 * What one dragon's roll amounts to.
 *
 * `againstDragon` decides breath: against another dragon it is five points of damage
 * like any other icon, against an army it kills five health-worth of units outright
 * and applies an elemental effect, which is a different thing entirely and is why it
 * is counted separately rather than folded into `damage`.
 */
export function dragonTotals(
  state: GameState,
  rolls: readonly DragonRoll[],
  againstDragon: boolean,
): DragonAttackTotals {
  let damage = 0
  let breaths = 0
  let treasures = 0
  let bellyUp = false
  let flies = false

  for (const roll of rolls) {
    const icon = rolledIcon(state, roll)
    if (icon === 'BREATH' && !againstDragon) {
      breaths += 1
      continue
    }
    if (icon === 'TREASURE') {
      if (!againstDragon) treasures += 1
      continue
    }
    if (icon === 'BELLY') bellyUp = true
    if (icon === 'WING') flies = true
    damage += ICON_DAMAGE[icon]
  }

  return { damage, breaths, treasures, bellyUp, flies }
}

/**
 * What it takes to kill this dragon in this attack: ten, or five if it showed its
 * belly (p. 20).
 *
 * The five automatic saves are why an army needs ten of one type rather than the
 * dragon's five health, and Belly is the only thing that removes them.
 */
export function killThreshold(bellyUp: boolean): number {
  return DRAGON_HEALTH + (bellyUp ? 0 : DRAGON_AUTOMATIC_SAVES)
}

/**
 * The elemental breath effects (p. 20), by the dragon's own element.
 *
 * Four of the five are a duration effect on the army and are built as `Modifier`s;
 * Fire is the odd one, killing and then burying whatever fails a save roll, which is
 * a sub-roll rather than a modifier and lives in the phase rather than here.
 */
export type BreathEffect = 'halve_melee' | 'ignore_id' | 'halve_maneuver' | 'bury_killed' | 'halve_missile'

export const BREATH_EFFECT: Readonly<Record<DragonElement, BreathEffect>> = {
  air: 'halve_melee',
  death: 'ignore_id',
  earth: 'halve_maneuver',
  fire: 'bury_killed',
  water: 'halve_missile',
}

/** The name the rules give each breath, for the log and the prompt. */
export const BREATH_NAME: Readonly<Record<DragonElement, string>> = {
  air: 'Lightning Bolt',
  death: 'Dragon Plague',
  earth: 'Petrify',
  fire: 'Dragon Fire',
  water: 'Poisonous Cloud',
}

export const BREATH_TEXT: Readonly<Record<DragonElement, string>> = {
  air: "The army's melee results are halved until the beginning of its next turn.",
  death: 'The army ignores all of its ID results until the beginning of its next turn.',
  earth: "The army's maneuver results are halved until the beginning of its next turn.",
  fire: 'Roll the units killed by this breath. Those that do not generate a save result are buried.',
  water: "The army's missile results are halved until the beginning of its next turn.",
}

/** How much health-worth one breath kills (p. 20). */
export const BREATH_KILL_HEALTH = 5

/**
 * What each icon does, in the rules' own words (p. 20).
 *
 * Beside the arithmetic rather than in either client, for the reason `SAI_TEXT` is:
 * both the browser and the terminal need the sentence, and a number that changes
 * next to a sentence that does not is drift this project has been bitten by twice.
 */
export const DRAGON_ICON_TEXT: Readonly<Record<DragonIcon, string>> = {
  JAWS: 'Inflicts twelve points of damage.',
  CLAW: 'Inflicts six points of damage.',
  WING: 'Inflicts five points of damage, then flies home if it survives the attack.',
  TAIL: 'Inflicts three points of damage; roll the dragon again and apply that too.',
  BELLY: "This dragon's five automatic saves do not count during this attack.",
  BREATH: 'Against an army, kills five health-worth and applies its element. Against a dragon, five points of damage and roll again.',
  TREASURE: 'If it is attacking an army, one unit in that army may be promoted.',
}
