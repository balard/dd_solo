/**
 * Every roll, one stop at a time (v2 Phase 3c).
 *
 * The game does not move past a roll until the player has seen it: the opponent waits,
 * and your own next decision waits, while `useGame`'s cursor walks these steps. That
 * costs a tap per roll, knowingly -- seeing each roll is the point, and a faster path is
 * a later problem.
 *
 * **Derived from the log, never stored beside it.** The steps are a pure function of the
 * log entries not yet shown; the cursor is the only state, and it lives in the client.
 * So the golden digests cannot see any of this.
 *
 * **The rules' own order.** A roll nobody resists -- magic above all -- is one stop,
 * then whatever the roll was for (spell picking). A resisted roll -- melee, missile, a
 * contested maneuver -- is the roller's dice, then the resisting roll (saves, or the
 * opposing maneuver) with what the two came to. Rerolls are shown where they happened:
 * chained to the die that threw again, on the roll's own strip.
 *
 * **An SAI is a stop of its own only when it has something to resolve**: targets to
 * pick, a unit to put to sleep, dice to reroll. Smite, Counter and the like only change
 * the numbers, and the roll's own card already marks them (`+4` on the die, named in the
 * sum). What the SAI resolved is logged *before* the exchange that caused it -- the
 * victims, a sub-roll -- so those entries are carried onto the SAI's own stop rather
 * than shown ahead of the attack that rolled it.
 *
 * **A roll is shown when it lands, not when it is logged.** The engine writes an
 * exchange down only once it is over, and an SAI decision sits in the middle of it -- so
 * the log alone put a Swallow's question *before* the attack that rolled it, and the
 * attack card after the answer. A roll parked mid-decision (`rollsOnTheTable`) is
 * therefore a stop of its own, a `live` one, ahead of the decision. The cursor
 * remembers which parked rolls it showed (`RollCursor.shown`), and the log's copy of
 * that roll is skipped when the exchange is written down: the attack, or a magic roll,
 * or the marching side of a contested maneuver. The resisting roll and what the two
 * came to still stop, since that is what the decision led to.
 *
 * **Your own SAI's card is dropped; what it rolled is not.** You answered it in a sheet
 * that printed the rule above the same dice, so a card after it said nothing new: a
 * Ferry card, with the rule and nobody moved, after you had just said where it went. A
 * sub-roll or Confuse's reroll is still news, and is a roll stop of its own -- the
 * enemy's dice, rolling for their lives. The enemy's SAIs keep their cards, since their
 * choices are made where you cannot see them.
 *
 * **The enemy's spells are a stop**: what was cast, and what each one did and where,
 * which is the lines after each `spell_cast` until the next. Your own are not -- you
 * just chose them -- though a roll inside them (the enemy's saves against a Hailstorm)
 * still is.
 *
 * Entries that are none of these -- a march begun, a terrain turned, a unit killed --
 * are not stops. They are on the board as they happen, and in the ticker.
 */
import type { DieRoll } from '../../engine/roll'
import { rollsOnTheTable, type TableRoll } from '../../engine/turn'
import type { GameState, LogEntry, PlayerId, UnitId } from '../../engine/types'

import {
  combatExchange,
  dragonExchange,
  exchangeAt,
  liveExchange,
  magicExchange,
  maneuverExchange,
  resolves,
  stepOfDie,
  type BarStep,
  type CombatEntry,
  type Exchange,
  type ManeuverEntry,
} from './exchange'

export type { CombatEntry, ManeuverEntry } from './exchange'

/**
 * Whether `LogLine` draws anything for this entry. The two kinds it renders as `null`,
 * named here so the ticker skips them rather than drawing a blank. The case in `LogLine`
 * points back here: keep the two lists in step.
 */
export function logShows(entry: LogEntry): boolean {
  return entry.kind !== 'game_start' && entry.kind !== 'terrain_placed'
}

type KillEntry = Extract<LogEntry, { kind: 'units_killed' }>

/**
 * One stop. Each carries the exchange it belongs to (v2 Phase 9b), which the step bar
 * draws -- optional, because a roll-off, a Replanting or a spell cast between marches
 * belongs to none.
 */
export type RollStep = (
  /** A roll nobody resists, drawn whole by `LogLine`. */
  | { readonly kind: 'roll'; readonly entry: LogEntry }
  | { readonly kind: 'attack'; readonly entry: CombatEntry }
  /**
   * The saves and what the exchange came to -- or the outcome alone, with no save roll.
   * `outcomeOnly` when the save roll was already shown live (9a finding 9): the strip
   * was on screen a moment ago, so this card is the Result step and draws only that.
   */
  | { readonly kind: 'resist'; readonly entry: CombatEntry; readonly outcomeOnly?: true }
  | { readonly kind: 'maneuver'; readonly entry: ManeuverEntry }
  /** The opposing maneuver and who won. */
  | { readonly kind: 'counter_maneuver'; readonly entry: ManeuverEntry }
  /**
   * One die whose SAI had something to resolve, and the log's account of what it did:
   * the targets picked, a sub-roll, an effect settling.
   */
  | { readonly kind: 'sai'; readonly die: DieRoll; readonly resolved: readonly LogEntry[] }
  /** The enemy's spells resolving: each cast and the lines that say what it did. */
  | { readonly kind: 'spells'; readonly entries: readonly LogEntry[] }
  /**
   * What the enemy lost to an exchange's damage (9a finding 7). They choose who falls
   * out of sight, after you continue past the saves, and the dice used to leave the
   * board with no card at all. Yours are not a stop: you just chose them.
   */
  | { readonly kind: 'losses'; readonly entry: KillEntry }
  /** A roll still parked while somebody decides about it: shown as it landed. */
  | { readonly kind: 'live'; readonly roll: TableRoll }
) & {
  readonly exchange?: Exchange
  /**
   * The first log entry this stop shows for the first time (v2 Phase 9c): the board,
   * the ticker and the log hold everything from here back until the stop has been seen.
   * Absent on a stop that only shows a roll again -- the attack's dice, the marching
   * maneuver, a parked roll -- since its entry is written with the stop that follows it.
   */
  readonly at?: number
}

/** `exchange` only when there is one: `exactOptionalPropertyTypes` takes no `undefined`. */
const inExchange = (exchange: Exchange | null): { exchange?: Exchange } =>
  exchange === null ? {} : { exchange }

/** `at` only when there is one. */
const atIndex = (at: number | undefined): { at?: number } => (at === undefined ? {} : { at })

/**
 * Who maneuvered, read off whose dice rolled: `maneuver_contested` does not say, and a
 * card has to ("you win", not "the marcher wins"). Undefined only when neither side
 * rolled a die, which a contest never does.
 */
export function marcherOf(entry: ManeuverEntry, ownerOf: OwnerOf): PlayerId | undefined {
  const marching = entry.marcherDice[0]
  const owner = marching === undefined ? undefined : ownerOf(marching.unitId)
  if (owner !== undefined) return owner
  const opposing = entry.defenderDice[0]
  const other = opposing === undefined ? undefined : ownerOf(opposing.unitId)
  return other === undefined ? undefined : other === 'p1' ? 'p2' : 'p1'
}

/**
 * Which parked roll a `live` stop was. The maneuver pair is two, because only the
 * marching side's is repeated by the log's card; the opposing one comes back with the
 * outcome, and after Rapid Growth it may not be the same roll.
 */
export type LiveKind = 'attack' | 'save' | 'maneuver' | 'counter_maneuver'

/** Entries that are one whole roll, and a stop of their own. */
const WHOLE_ROLLS: ReadonlySet<LogEntry['kind']> = new Set<LogEntry['kind']>([
  'roll_off',
  'order_of_play',
  'magic_rolled',
  'sai_sub_roll',
  'spell_saves',
  'thorns',
  'replanting',
  'units_risen',
  'dragon_attack',
  'dragon_roll',
])

/** What an SAI resolved that its roller has not seen yet: dice thrown after the choice. */
const NEWS: ReadonlySet<LogEntry['kind']> = new Set<LogEntry['kind']>(['sai_sub_roll', 'confused'])

/** Whose die this is. Units never change owner, so today's state answers for any entry. */
export type OwnerOf = (unitId: UnitId) => PlayerId | undefined

/** The SAI an entry is the resolution of, when it is one. */
function resolutionOf(entry: LogEntry): string | null {
  switch (entry.kind) {
    case 'sai_resolved':
    case 'confused':
      return entry.sai
    case 'units_promoted':
      return entry.sai ?? null
    case 'effect_cast':
      return entry.source
    // A sub-roll is rolled *for* one SAI's targets, and follows its `sai_resolved`.
    case 'sai_sub_roll':
      return entry.source
    default:
      return null
  }
}

/** What a spell's resolution writes after its `spell_cast`. */
const SPELL_RUN: ReadonlySet<LogEntry['kind']> = new Set<LogEntry['kind']>([
  'spell_cast',
  'spell_fizzled',
  // The attempt to stop the spells that follow it -- part of the run it interrupts.
  'dispel_magic',
  'effect_cast',
  'units_moved',
  'units_killed',
  'units_buried',
  'units_risen',
  'replanting',
  'units_regrown',
  'units_resurrected',
  'flash_flood',
  'spell_saves',
  // Mirage and Lightning Strike put their targets through a sub-roll.
  'sai_sub_roll',
  'dragon_summoned',
  'dragon_home',
])
/** The line that names a spell: cast, or fizzled with its target gone. */
const namesSpell = (entry: LogEntry): entry is Extract<LogEntry, { kind: 'spell_cast' | 'spell_fizzled' }> =>
  entry.kind === 'spell_cast' || entry.kind === 'spell_fizzled'

/**
 * A run of spell lines, one spell at a time with its name first.
 *
 * **The engine writes a spell's consequences before its `spell_cast` line** (`turn.ts`
 * resolves, then logs the cast), so read forwards the log says "Ash Storm settles on
 * Enemy home", then "the enemy casts Ash Storm". Each spell is the lines up to and
 * including its name, and here the name moves to the front. Lines after the last name
 * belong to that last spell.
 */
function spellBySpell(run: readonly LogEntry[]): readonly LogEntry[] {
  const spells: LogEntry[][] = []
  let lines: LogEntry[] = []
  for (const entry of run) {
    if (namesSpell(entry)) {
      spells.push([entry, ...lines])
      lines = []
    } else {
      lines.push(entry)
    }
  }
  const last = spells[spells.length - 1]
  if (last !== undefined) last.push(...lines)
  return spells.flat()
}

/**
 * The stops in these log entries, in order. `human` decides whose spells are news: the
 * enemy's are a stop, yours are not.
 */
export function rollSteps(
  entries: readonly LogEntry[],
  human: PlayerId,
  ownerOf: OwnerOf,
): readonly RollStep[] {
  return logSteps(entries, 0, human, ownerOf, [], null).steps
}

/**
 * Entries that begin something new. An exchange's SAIs, its Cantrip spells and its
 * losses never reach past one, so the searches below stop there.
 */
const BOUNDARY: ReadonlySet<LogEntry['kind']> = new Set<LogEntry['kind']>([
  'march_begin',
  'march_skipped',
  'action_chosen',
  'action_skipped',
  'maneuver_declared',
  'counter_declined',
  'turn_end',
  'dragon_attack',
])

/** What may follow an exchange's damage before the enemy's losses are written. */
const AFTERMATH: ReadonlySet<LogEntry['kind']> = new Set<LogEntry['kind']>([
  'units_killed',
  'units_buried',
  'units_risen',
  'replanting',
  'units_regrown',
])

/**
 * The exchange an entry belongs to, looking forward: the log writes an exchange down
 * only when it is over, so its SAI resolutions and its Cantrip spells come first.
 */
function combatAhead(log: readonly LogEntry[], i: number): CombatEntry | null {
  for (let j = i; j < log.length; j++) {
    const entry = log[j] as LogEntry
    if (entry.kind === 'combat_resolved') return entry
    if (BOUNDARY.has(entry.kind) || entry.kind === 'magic_rolled') return null
  }
  return null
}

/** The newest entry of a kind before `i`, within the current exchange. */
function behind<K extends LogEntry['kind']>(
  log: readonly LogEntry[],
  i: number,
  kind: K,
): Extract<LogEntry, { kind: K }> | null {
  for (let j = i - 1; j >= 0; j--) {
    const entry = log[j] as LogEntry
    if (entry.kind === kind) return entry as Extract<LogEntry, { kind: K }>
    if (BOUNDARY.has(entry.kind) || entry.kind === 'combat_resolved' || entry.kind === 'magic_rolled') return null
  }
  return null
}

/** The exchange whose damage a kill at `i` paid, or null when it paid something else. */
function damageBehind(log: readonly LogEntry[], i: number): Exchange | null {
  for (let j = i - 1; j >= 0; j--) {
    const entry = log[j] as LogEntry
    if (entry.kind === 'combat_resolved') return combatExchange(entry, 'result')
    if (entry.kind === 'dragon_damage') return dragonExchange(entry.player, entry.slot, 'result')
    if (!AFTERMATH.has(entry.kind)) return null
  }
  return null
}

/**
 * `rollSteps` over `log` from `from`, skipping the parts of the next exchange already
 * shown live. Also returns the shown kinds whose entry is not logged yet: their
 * exchange is still paused. `live` is the state those entries led to, when there is
 * one, for an exchange still paused that a stop belongs to.
 *
 * The whole log is passed, not a slice, because a stop may belong to an exchange
 * written before the cursor: the enemy's losses are written after you continue past
 * the saves.
 */
function logSteps(
  log: readonly LogEntry[],
  from: number,
  human: PlayerId,
  ownerOf: OwnerOf,
  shown: readonly LiveKind[],
  live: GameState | null,
): {
  readonly steps: readonly RollStep[]
  /** SAIs that resolved while their exchange is still paused: see the end. */
  readonly early: readonly RollStep[]
  readonly unlogged: readonly LiveKind[]
} {
  let unlogged = shown
  const seen = (kind: LiveKind): boolean => unlogged.includes(kind)
  const steps: RollStep[] = []
  // SAI resolutions logged ahead of the exchange that rolled them, waiting for it,
  // and where each was written.
  let waiting: LogEntry[] = []
  const indexOf = new Map<LogEntry, number>()
  const paused = (): Exchange | null => (live === null ? null : liveExchange(live))

  /**
   * The SAI stops of a roll. `at` is the index of the exchange's own entry: an SAI that
   * resolved before the cursor was shown then (see the end), and is not shown again
   * now that the exchange is written down.
   */
  const saiSteps = (
    dice: readonly DieRoll[],
    exchangeOf: (die: DieRoll) => Exchange,
    at: number | null,
  ): readonly RollStep[] =>
    dice.filter(resolves).flatMap((die): readonly RollStep[] => {
      const name = die.face.icon === 'SAI' ? die.face.sai : null
      if (name !== null && at !== null && resolvedBefore(log, at, from, name)) return []
      const resolved = waiting.filter((entry) => name !== null && resolutionOf(entry) === name)
      waiting = waiting.filter((entry) => !resolved.includes(entry))
      const exchange = exchangeOf(die)
      // Your own, already answered: only what it rolled is news. See the header.
      if (ownerOf(die.unitId) === human) {
        return resolved
          .filter((entry) => NEWS.has(entry.kind))
          .map((entry) => ({ kind: 'roll', entry, exchange, ...atIndex(indexOf.get(entry)) }))
      }
      const first = resolved.flatMap((entry) => indexOf.get(entry) ?? [])
      return [{ kind: 'sai', die, resolved, exchange, ...atIndex(first.length === 0 ? undefined : Math.min(...first)) }]
    })

  /**
   * A run of spells: a magic action's, or a Cantrip window's inside an exchange. The
   * window's exchange is ahead in the log, or still paused, and the Cantrip chip is lit
   * on the step whose roll showed it -- the attacker's on SAIs, the saver's on Saves.
   */
  const spellsExchange = (i: number): Exchange | null => {
    const cantrip = behind(log, i, 'cantrip')
    if (cantrip !== null) {
      const ahead = combatAhead(log, i)
      if (ahead !== null) {
        const at: BarStep = cantrip.player === ahead.attacker ? 'sais' : 'resist'
        return exchangeAt(combatExchange(ahead, at), at, 'Cantrip')
      }
      const now = paused()
      return now === null ? null : exchangeAt(now, cantrip.player === now.roller ? 'sais' : 'resist', 'Cantrip')
    }
    const magic = behind(log, i, 'magic_rolled')
    return magic === null ? null : magicExchange(magic, 'result')
  }

  for (let i = from; i < log.length; i++) {
    const entry = log[i] as LogEntry

    // Spells: a run of spell lines that names at least one spell. The consequences come
    // first in the log, so the run is found by looking ahead from its first line.
    if (SPELL_RUN.has(entry.kind)) {
      let end = i
      while (end < log.length && SPELL_RUN.has((log[end] as LogEntry).kind)) end++
      const run = log.slice(i, end)
      const named = run.find(namesSpell)
      if (named !== undefined) {
        const exchange = inExchange(spellsExchange(i))
        if (named.player !== human) {
          steps.push({ kind: 'spells', entries: spellBySpell(run), ...exchange, at: i })
        } else {
          // Your own: no stop for the casting, but a roll inside it still is one.
          run.forEach((inner, k) => {
            if (WHOLE_ROLLS.has(inner.kind)) steps.push({ kind: 'roll', entry: inner, ...exchange, at: i + k })
          })
        }
        i = end - 1
        continue
      }
    }

    if (resolutionOf(entry) !== null) {
      waiting.push(entry)
      indexOf.set(entry, i)
      continue
    }

    switch (entry.kind) {
      // The first of these after a live stop is the exchange that stop was parked in:
      // nothing else can be written down while it is paused.
      case 'combat_resolved': {
        if (!seen('attack')) steps.push({ kind: 'attack', entry, exchange: combatExchange(entry, 'roll') })
        // Saves shown live means the step-4 SAIs were shown just before them.
        const attackSais = seen('save') ? entry.attackDice.filter((die) => stepOfDie(die) !== 'sais') : entry.attackDice
        steps.push(...saiSteps(attackSais, (die) => combatExchange(entry, stepOfDie(die), die), i))
        // A save roll shown live is not drawn twice: this is its Result (9a finding 9).
        // Unless a Flashfire rerolled it after it was shown -- found in a browser, a
        // Firewalking that came back a Cantrip -- and then the dice are news again.
        const rerolled = log
          .slice(from, i)
          .some((earlier) => earlier.kind === 'flashfire' && earlier.player === entry.defender)
        steps.push(
          seen('save') && !rerolled
            ? { kind: 'resist', entry, outcomeOnly: true, exchange: combatExchange(entry, 'result'), at: i }
            : { kind: 'resist', entry, exchange: combatExchange(entry, 'resist'), at: i },
        )
        unlogged = unlogged.filter((kind) => kind !== 'attack' && kind !== 'save')
        break
      }
      case 'maneuver_contested': {
        const marcher = marcherOf(entry, ownerOf)
        const at = (step: BarStep) => inExchange(marcher === undefined ? null : maneuverExchange(entry, marcher, step))
        if (!seen('maneuver')) steps.push({ kind: 'maneuver', entry, ...at('roll') })
        steps.push(...saiSteps(entry.marcherDice, () => maneuverExchange(entry, marcher ?? 'p1', 'sais'), i))
        // Shown live already, at Rapid Growth: this is what the contest came to.
        steps.push({ kind: 'counter_maneuver', entry, ...at(seen('counter_maneuver') ? 'result' : 'resist'), at: i })
        unlogged = unlogged.filter((kind) => kind !== 'maneuver' && kind !== 'counter_maneuver')
        break
      }
      case 'magic_rolled':
        if (!seen('attack')) steps.push({ kind: 'roll', entry, exchange: magicExchange(entry, 'roll'), at: i })
        steps.push(...saiSteps(entry.dice, (die) => magicExchange(entry, 'sais', die), i))
        unlogged = unlogged.filter((kind) => kind !== 'attack')
        break
      // A Rise from the Ashes that rolled nothing -- no Phoenix died -- is not a roll.
      case 'units_risen':
        if ((entry.dice?.length ?? 0) > 0) steps.push({ kind: 'roll', entry, at: i })
        break
      case 'units_killed': {
        // The enemy's dead from an exchange's damage. Yours you chose; a spell's or an
        // SAI's are on their own cards already.
        const paid = entry.player === human ? null : damageBehind(log, i)
        if (paid !== null) steps.push({ kind: 'losses', entry, exchange: paid, at: i })
        break
      }
      case 'dragon_attack':
        steps.push({ kind: 'roll', entry, exchange: dragonExchange(entry.defender, entry.slot, 'roll'), at: i })
        break
      case 'dragon_roll':
        steps.push({ kind: 'roll', entry, exchange: dragonExchange(entry.player, entry.slot, 'resist'), at: i })
        break
      default:
        if (WHOLE_ROLLS.has(entry.kind)) steps.push({ kind: 'roll', entry, at: i })
    }
  }

  // Resolutions whose exchange is not in the log yet -- it is paused on a decision --
  // are shown where they are rather than held back past it. Found in a browser: the
  // enemy's Firewalking moved its dice, the exchange paused again on your Cantrip, and
  // its card came only once the exchange was written -- after the saves, and without
  // the move, which was behind the cursor by then. So an SAI whose resolution is here
  // is shown now, off the attack still parked, and `saiSteps` skips it later.
  //
  // And once the save dice are on the table every step-4 SAI has been answered, even
  // one that logged nothing -- a Firewalking that stayed put -- so the first time the
  // saves are shown, those go just before them, and the written exchange skips them.
  const now = paused()
  const parkedRolls = live === null ? [] : rollsOnTheTable(live)
  const parkedAttack = parkedRolls.find((roll) => roll.kind === 'attack')
  const savesNow = parkedRolls.some((roll) => roll.kind === 'save') && !seen('save')
  const named = (die: DieRoll): string | null => (die.face.icon === 'SAI' ? die.face.sai : null)
  const early =
    parkedAttack === undefined || now === null
      ? []
      : saiSteps(
          parkedAttack.roll.dice.filter(
            (die) =>
              waiting.some((entry) => resolutionOf(entry) === named(die)) || (savesNow && stepOfDie(die) === 'sais'),
          ),
          (die) => exchangeAt(now, stepOfDie(die), named(die) ?? undefined),
          log.length,
        )
  // What is left is a sub-roll with no parked attack to hang it on: shown where it is.
  for (const entry of waiting) {
    if (entry.kind === 'sai_sub_roll') {
      steps.push({ kind: 'roll', entry, ...inExchange(now && exchangeAt(now, 'sais')), ...atIndex(indexOf.get(entry)) })
    }
  }
  return { steps, early, unlogged }
}

/**
 * Whether an SAI of this name resolved in this exchange before `from` -- and so was
 * shown then, as it resolved, while the exchange was paused (`logSteps`' end).
 */
function resolvedBefore(log: readonly LogEntry[], at: number, from: number, name: string): boolean {
  for (let j = at - 1; j >= 0; j--) {
    const entry = log[j] as LogEntry
    if (BOUNDARY.has(entry.kind) || entry.kind === 'combat_resolved' || entry.kind === 'magic_rolled') return false
    if (j < from && resolutionOf(entry) === name) return true
  }
  return false
}

/** The rolls parked mid-decision that a live stop can show, by kind. A dragon roll
 *  has no log card to stand in for, so it stays in the decision sheet alone. */
function parked(state: GameState): readonly { readonly kind: LiveKind; readonly roll: TableRoll }[] {
  return rollsOnTheTable(state).flatMap((roll): { kind: LiveKind; roll: TableRoll }[] => {
    switch (roll.kind) {
      case 'attack':
      case 'save':
        return [{ kind: roll.kind, roll }]
      case 'maneuver':
        return [{ kind: roll.player === state.turn.marching ? 'maneuver' : 'counter_maneuver', roll }]
      case 'dragon':
        return []
    }
  })
}

/** The step a parked roll is, in its exchange's bar. */
const LIVE_STEP: Readonly<Record<LiveKind, BarStep>> = {
  attack: 'roll',
  save: 'resist',
  maneuver: 'roll',
  counter_maneuver: 'resist',
}

/**
 * Every stop from the cursor on: the log's, then any roll still parked that has not
 * been shown. This is what `useGame` walks.
 */
export function rollStops(state: GameState, cursor: RollCursor, human: PlayerId): readonly RollStep[] {
  const { steps, early, unlogged } = logSteps(state.log, cursor.log, human, ownerIn(state), cursor.shown ?? [], state)
  const exchange = liveExchange(state)
  const live = parked(state)
    .filter(({ kind }) => !unlogged.includes(kind))
    .map(({ kind, roll }): { readonly kind: LiveKind; readonly step: RollStep } => ({
      kind,
      step: { kind: 'live', roll, ...inExchange(exchange && exchangeAt(exchange, LIVE_STEP[kind])) },
    }))
  // The rules' order: the attack, then the SAIs it showed that have resolved, then the
  // saves -- whichever of them have not been shown yet.
  const attack = live.filter(({ kind }) => kind === 'attack').map(({ step }) => step)
  const rest = live.filter(({ kind }) => kind !== 'attack').map(({ step }) => step)
  return [...steps, ...attack, ...early, ...rest]
}

/**
 * Where the player is in the rolls: the log index the pending ones start at, and how
 * many of the steps from there have been shown. `{ log: n, step: 0 }` with nothing
 * after `n` means nothing is waiting.
 */
export interface RollCursor {
  readonly log: number
  readonly step: number
  /** Parked rolls already shown as `live` stops, whose exchange is not logged yet.
   *  Omitted when there are none. */
  readonly shown?: readonly LiveKind[]
}

/** The cursor after one more step is seen -- or past everything, once all have been. */
export function advanceCursor(state: GameState, cursor: RollCursor, human: PlayerId): RollCursor {
  return cursor.step + 1 < rollStops(state, cursor, human).length
    ? { ...cursor, step: cursor.step + 1 }
    : pastEverything(state)
}

/**
 * Past every stop there is. Whatever is parked now has been shown -- just now, or by an
 * earlier live stop the log has not caught up with -- and a kind no longer parked was
 * written down in the entries this passes.
 */
export function pastEverything(state: GameState): RollCursor {
  const shown = parked(state).map(({ kind }) => kind)
  return shown.length > 0 ? { log: state.log.length, step: 0, shown } : { log: state.log.length, step: 0 }
}

/** `OwnerOf` over a game's units. */
export const ownerIn =
  (state: GameState): OwnerOf =>
  (unitId) =>
    state.units[unitId]?.owner

/**
 * What the board must not show yet, while stop `current` of `steps` is on screen
 * (v2 Phase 9c): every log entry from `from` on. Null when nothing is held back.
 *
 * A stop reveals the entries from its own `at` up to the next stop's, so an entry with
 * no stop of its own -- a kill a Firecloud's sub-roll led to, a terrain turned after a
 * contest -- belongs to the stop before it and waits for that one. An entry ahead of
 * every stop (a march begun, an action chosen) has nothing to wait for.
 *
 * `marking` is the part this stop reveals (9a finding 8): held back like the rest, so
 * the die is still where it stood, but the board marks it, and the card and the board
 * point at one die. Empty when this stop reveals nothing, or shares its entry with a
 * stop after it -- the attack and the saves are one `combat_resolved`, and it is the
 * saves' card that says what it came to.
 */
export function heldBack(
  steps: readonly RollStep[],
  current: number,
): { readonly from: number; readonly marking: readonly [number, number] } | null {
  const ats = (fromStep: number): readonly number[] =>
    steps.slice(fromStep).flatMap((step) => (step.at === undefined ? [] : [step.at]))
  const ahead = ats(current)
  if (ahead.length === 0) return null
  const from = Math.min(...ahead)
  if (steps[current]?.at !== from) return { from, marking: [from, from] }
  const after = ats(current + 1)
  return { from, marking: [from, after.length === 0 ? Infinity : Math.min(...after)] }
}
