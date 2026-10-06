/**
 * The exchange a roll card or a decision sheet belongs to (v2 Phase 9b), which the step
 * bar draws.
 *
 * **The bar belongs to the exchange, not to one card** (9a finding 1). The attack card,
 * a Flame's target sheet, the saves card and your damage sheet are one melee exchange,
 * and they all draw the same bar with a different step lit. That is what replaced
 * "roll 1 of 2", which counted cards and said nothing about where the exchange stood.
 *
 * Two doors, one shape:
 * - **a logged stop** is placed by `presentation.ts`, which has the log entry in hand
 *   (`combatExchange`, `maneuverExchange`, `magicExchange`, `dragonExchange`);
 * - **a decision** is placed by `liveExchange`, from the state it is asked in -- the
 *   march step says where the machine stands, and `rollsOnTheTable` which SAIs rolled.
 *
 * Presentation only, like every file here: nothing in the engine knows about a bar.
 */
import type { DieRoll } from '../../engine/roll'
import { rollsOnTheTable } from '../../engine/turn'
import type { ArmyRef, GameState, LogEntry, MarchStep, Pending, PlayerId } from '../../engine/types'

export type CombatEntry = Extract<LogEntry, { kind: 'combat_resolved' }>
export type ManeuverEntry = Extract<LogEntry, { kind: 'maneuver_contested' }>
type MagicEntry = Extract<LogEntry, { kind: 'magic_rolled' }>

/** Which bar: the action names its first step. */
export type ExchangeKind = 'melee' | 'missile' | 'magic' | 'counter' | 'volley' | 'maneuver' | 'dragon'

/**
 * A step of an exchange. Every kind uses some of these four, in this order: the roll
 * that opens it, its SAIs, the roll that resists it, and what they came to.
 */
export type BarStep = 'roll' | 'sais' | 'resist' | 'result'
const ORDER: readonly BarStep[] = ['roll', 'sais', 'resist', 'result']
const before = (a: BarStep, b: BarStep): boolean => ORDER.indexOf(a) < ORDER.indexOf(b)

export type ChipState = 'waiting' | 'now' | 'done'

/** An SAI with something to resolve, on the step where it resolves. */
export interface SaiChip {
  readonly name: string
  readonly on: 'sais' | 'resist'
  readonly state: ChipState
  /**
   * Rolled by the resisting roll rather than the opening one. Such a chip is drawn only
   * from the resisting step on: on the attack card nobody has seen the save dice yet,
   * and a chip there would give them away. A delayed SAI is on Saves too, but it is
   * the attack's, so it shows from the start.
   */
  readonly resisting?: true
}

export interface Exchange {
  readonly kind: ExchangeKind
  /** Whose roll opened it: the attacker, the marcher, the caster -- or, for a dragon
   *  attack, the army the dragons fell on. */
  readonly roller: PlayerId
  /** Where it happens: the army attacked, the terrain maneuvered, the caster's army. */
  readonly slot: ArmyRef
  readonly at: BarStep
  readonly chips: readonly SaiChip[]
  /** Steps this exchange skipped: no save roll (magic in the v0 house rule, a zero
   *  attack), or a maneuver nobody contested. Struck through, never hidden. */
  readonly none?: readonly BarStep[]
}

/** The steps of one kind of exchange, labelled. */
export function barSteps(kind: ExchangeKind): readonly { readonly step: BarStep; readonly label: string }[] {
  const fight = (label: string) =>
    [
      { step: 'roll', label },
      { step: 'sais', label: 'SAIs' },
      { step: 'resist', label: 'Saves' },
      { step: 'result', label: 'Result' },
    ] as const
  switch (kind) {
    case 'melee':
      return fight('Melee')
    case 'missile':
      return fight('Missile')
    case 'counter':
      return fight('Counter')
    case 'volley':
      return fight('Volley')
    case 'magic':
      return [
        { step: 'roll', label: 'Magic' },
        { step: 'sais', label: 'SAIs' },
        { step: 'result', label: 'Spells' },
      ]
    case 'maneuver':
      return [
        { step: 'roll', label: 'Maneuver' },
        { step: 'sais', label: 'SAIs' },
        { step: 'resist', label: 'Contest' },
        { step: 'result', label: 'Result' },
      ]
    case 'dragon':
      return [
        { step: 'roll', label: 'Dragons' },
        { step: 'resist', label: 'Army' },
        { step: 'result', label: 'Result' },
      ]
  }
}

/**
 * How a step is drawn. An empty SAIs step is struck through at every point but its
 * own, so the bar has one shape per action and says "nothing fired here" rather than
 * leaving a gap (9a finding 1).
 */
export function stepState(exchange: Exchange, step: BarStep): 'done' | 'now' | 'todo' | 'none' {
  if (step === exchange.at) return 'now'
  if (exchange.none?.includes(step)) return 'none'
  if (step === 'sais' && !exchange.chips.some((chip) => chip.on === 'sais')) return 'none'
  return before(step, exchange.at) ? 'done' : 'todo'
}

/** SAI effects that leave something to resolve. The rest only change the numbers. */
const RESOLVES: ReadonlySet<string> = new Set([
  'target_enemy',
  'sleep',
  'galeforce',
  'choke',
  'confuse',
  'wild_growth',
  'free_move',
  // Illusion (v2 Phase 8d): a shield on an army, which the board then draws.
  'illusion',
])

/** Whether a die's SAI resolves something -- a stop of its own when it is the enemy's. */
export const resolves = (die: DieRoll): boolean => (die.effects ?? []).some((effect) => RESOLVES.has(effect.kind))

/**
 * What earns a chip: everything that resolves, and three more that pause the exchange
 * without a card of their own -- a Cantrip window, a Regenerate and a Hypnotic Glare.
 * They are not stops, but the exchange does wait on them, which is what the bar is for.
 */
const CHIPPED: ReadonlySet<string> = new Set([...RESOLVES, 'cantrip', 'regenerate', 'glare'])

/** Applied when resolving Delayed Effects, after the save dice land (p. 27 step 2). */
const DELAYED: ReadonlySet<string> = new Set(['choke', 'confuse', 'glare'])

/** The step an attack die's SAI resolves on: a delayed one waits for the save dice. */
export const stepOfDie = (die: DieRoll): 'sais' | 'resist' =>
  (die.effects ?? []).some((effect) => DELAYED.has(effect.kind)) ? 'resist' : 'sais'

const saiOf = (die: DieRoll): string => (die.face.icon === 'SAI' ? die.face.sai : die.face.icon.toLowerCase())

interface Chipped {
  readonly die: DieRoll
  readonly name: string
  readonly on: 'sais' | 'resist'
  readonly resisting?: true
}

/** The dice in a roll that earn a chip, and where each resolves. A resisting roll's
 *  SAIs all sit on its own step. */
function chipped(dice: readonly DieRoll[], resisting: boolean): readonly Chipped[] {
  return dice
    .filter((die) => (die.effects ?? []).some((effect) => CHIPPED.has(effect.kind)))
    .map((die) => ({
      die,
      name: saiOf(die),
      on: resisting ? 'resist' : stepOfDie(die),
      ...(resisting ? { resisting: true as const } : {}),
    }))
}

/**
 * The chips' states at a step. A chip on an earlier step is done and one on a later
 * step is waiting. On the step itself, `current` picks the one resolving now: those
 * before it are done, and those after it wait -- and an SAI of the same name is now
 * too, since multiples of one SAI combine (p. 32). With no `current`, `onStep` says.
 */
function states(
  chips: readonly Chipped[],
  at: BarStep,
  current: ((chip: Chipped) => boolean) | null,
  onStep: ChipState,
): readonly SaiChip[] {
  const first = current === null ? -1 : chips.findIndex((chip) => chip.on === at && current(chip))
  const now = first < 0 ? null : (chips[first] as Chipped).name
  return chips.map((chip, i): SaiChip => {
    const { name, on } = chip
    const of = (state: ChipState): SaiChip => ({ name, on, state, ...(chip.resisting ? { resisting: true as const } : {}) })
    if (on !== at) return of(before(on, at) ? 'done' : 'waiting')
    if (now === null) return of(onStep)
    if (name === now) return of('now')
    return of(i < first ? 'done' : 'waiting')
  })
}

const counterKind = (action: string): ExchangeKind => (action === 'missile' ? 'volley' : 'counter')

/**
 * A logged combat at one of its stops. `current` is the attack die whose SAI is the
 * card on screen. Save-roll SAIs join only once the saves are on the table: on the
 * attack card nobody has rolled them yet.
 */
export function combatExchange(entry: CombatEntry, at: BarStep, current?: DieRoll): Exchange {
  const chips = [
    ...chipped(entry.attackDice, false),
    ...(before(at, 'resist') ? [] : chipped(entry.saveDice ?? [], true)),
  ]
  return {
    kind: entry.isCounter ? counterKind(entry.action) : entry.action,
    roller: entry.attacker,
    slot: entry.defenderSlot,
    at,
    chips: states(chips, at, current === undefined ? null : (chip) => chip.die === current, 'done'),
    ...(entry.saveTotal === null ? { none: ['resist'] as const } : {}),
  }
}

/** A logged contest, at one of its stops. `marcher` is whose maneuver it was. */
export function maneuverExchange(entry: ManeuverEntry, marcher: PlayerId, at: BarStep): Exchange {
  const chips = [
    ...chipped(entry.marcherDice, false),
    ...(before(at, 'resist') ? [] : chipped(entry.defenderDice, true)),
  ]
  return { kind: 'maneuver', roller: marcher, slot: entry.slot, at, chips: states(chips, at, null, 'done') }
}

/** A logged magic roll, at one of its stops. */
export function magicExchange(entry: MagicEntry, at: BarStep, current?: DieRoll): Exchange {
  return {
    kind: 'magic',
    roller: entry.player,
    slot: entry.slot,
    at,
    chips: states(
      chipped(entry.dice, false),
      at,
      current === undefined ? null : (chip) => chip.die === current,
      'done',
    ),
  }
}

/** A dragon attack, at one of its stops. Dragons roll faces, not SAIs: no chips. */
export function dragonExchange(defender: PlayerId, slot: ArmyRef, at: BarStep): Exchange {
  return { kind: 'dragon', roller: defender, slot, at, chips: [] }
}

/**
 * The same exchange redrawn at another step, its chips restated: what is before it
 * done, what is after it waiting. `lit` names the chip resolving now -- a Cantrip
 * window, or an SAI shown as it resolved -- and on its step the chips before it are
 * done and those after it wait. Without one, the step's chips keep their states.
 */
export function exchangeAt(exchange: Exchange, at: BarStep, lit?: string): Exchange {
  const chips = exchange.chips.filter((chip) => !(chip.resisting && before(at, 'resist')))
  const first = lit === undefined ? -1 : chips.findIndex((chip) => chip.on === at && chip.name === lit)
  return {
    ...exchange,
    at,
    chips: chips.map((chip, i): SaiChip => {
      if (chip.on !== at) return { ...chip, state: before(chip.on, at) ? 'done' : 'waiting' }
      if (first < 0) return chip
      if (chip.name === lit) return { ...chip, state: 'now' }
      return { ...chip, state: i < first ? 'done' : 'waiting' }
    }),
  }
}

// --- a decision, from the state it is asked in -----------------------------------

/** Where in an exchange the machine stands, by its march step. Null for a step that is
 *  no exchange's: choosing the army, the action, a target. */
function stepOfMarch(step: MarchStep): BarStep | null {
  switch (step) {
    case 'resolve_attack':
    case 'flashfire_attack':
    case 'resolve_counter':
    case 'flashfire_counter':
      return 'roll'
    case 'sai_target_attack':
    case 'sai_target_counter':
      return 'sais'
    case 'resolve_attack_saves':
    case 'flashfire_attack_saves':
    case 'sai_delayed_attack':
    case 'charge_allocate':
    case 'resolve_counter_saves':
    case 'flashfire_counter_saves':
    case 'sai_delayed_counter':
    case 'rapid_growth':
      return 'resist'
    case 'resolve_attack_damage':
    case 'assign_attack_damage':
    case 'assign_attack_riposte':
    case 'offer_counter':
    case 'foul_stench':
    case 'resolve_counter_damage':
    case 'assign_counter_damage':
    case 'assign_counter_riposte':
    case 'choose_direction':
      return 'result'
    default:
      return null
  }
}

const isCounterStep = (step: MarchStep): boolean => step.includes('counter') && step !== 'offer_counter'

/** The SAI a pending decision is about, when it is one. */
const saiAsked = (pending: Pending | null): string | null =>
  pending !== null && 'sai' in pending && typeof pending.sai === 'string' ? pending.sai : null

/** The newest log entry of a kind, for what a decision answers but no longer holds. */
function lastOf<K extends LogEntry['kind']>(state: GameState, kind: K): Extract<LogEntry, { kind: K }> | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const entry = state.log[i] as LogEntry
    if (entry.kind === kind) return entry as Extract<LogEntry, { kind: K }>
    if (entry.kind === 'march_begin' || entry.kind === 'turn_end') return null
  }
  return null
}

/**
 * The exchange a decision is asked in, or null when it is none's -- choosing an army,
 * an action, the reserves.
 *
 * The chips come off the rolls still parked (`rollsOnTheTable`), so they are the dice
 * the player can see behind the sheet. A Cantrip window is read as at the step it
 * returns to, with its chip lit, and a magic action's spell picking as the Spells step
 * of the roll the log already holds.
 */
export function liveExchange(state: GameState): Exchange | null {
  const { turn, pending } = state
  const opp = (player: PlayerId): PlayerId => (player === 'p1' ? 'p2' : 'p1')

  const dragon = turn.dragonAttack
  if (dragon !== undefined) {
    const at: BarStep =
      pending?.kind === 'dragon_allocate'
        ? 'resist'
        : pending?.kind === 'assign_damage' || pending?.kind === 'dragon_damage_split'
          ? 'result'
          : 'roll'
    return dragonExchange(dragon.defender, dragon.slot, at)
  }

  const step = turn.marchStep
  const army = turn.marchingArmy

  // A maneuver: Rapid Growth between the rolls, the direction after them.
  if (step === 'rapid_growth' || step === 'choose_direction') {
    if (army === null || army === 'reserve') return null
    const at = stepOfMarch(step) as BarStep
    const contested = lastOf(state, 'maneuver_contested')
    const allowed = lastOf(state, 'maneuver_allowed')
    return {
      kind: 'maneuver',
      roller: turn.marching,
      slot: army,
      at,
      chips: step === 'rapid_growth' ? [{ name: 'Rapid Growth', on: 'resist', state: 'now' }] : [],
      // Nobody contested: the direction follows a maneuver that was simply allowed.
      ...(step === 'choose_direction' && allowed !== null && contested === null ? { none: ['resist'] as const } : {}),
    }
  }

  const magic = turn.magic
  // A magic action's spells: the roll is in the log, and only the Spells step is left.
  if (magic !== undefined && magic.returnTo === undefined) {
    const rolled = lastOf(state, 'magic_rolled')
    return rolled === null
      ? { kind: 'magic', roller: turn.marching, slot: magic.army, at: 'result', chips: [] }
      : magicExchange(rolled, 'result')
  }

  const combat = turn.combat
  if (combat === null || army === null) return null
  // A Cantrip window is read as at the step it goes back to.
  const where = magic?.returnTo ?? step
  const at = stepOfMarch(where)
  if (at === null) return null

  const counter = isCounterStep(where)
  const rolls = rollsOnTheTable(state)
  // Past the rolls, the exchange is in the log already: read it there, chips and all.
  const logged = lastOf(state, 'combat_resolved')
  if (rolls.length === 0 && at === 'result' && logged !== null) return combatExchange(logged, 'result')

  const attacker = counter ? opp(turn.marching) : turn.marching
  // A counter is "Counter" here even when it will be a Defensive Volley: the log's
  // entry names that, and the bar only has the action the march chose to go on.
  const kind: ExchangeKind = counter ? 'counter' : combat.action
  const slot = counter ? army : combat.targetSlot

  const attackRoll = rolls.find((roll) => roll.kind === 'attack')
  const saveRoll = rolls.find((roll) => roll.kind === 'save')
  const chips = [...chipped(attackRoll?.roll.dice ?? [], false), ...chipped(saveRoll?.roll.dice ?? [], true)]
  const asked = magic !== undefined ? 'Cantrip' : saiAsked(pending)
  return {
    kind,
    roller: attacker,
    slot,
    at,
    chips: states(chips, at, asked === null ? null : (chip) => chip.name === asked, before(at, 'result') ? 'waiting' : 'done'),
  }
}
