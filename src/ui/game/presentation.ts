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

/**
 * Whether `LogLine` draws anything for this entry. The two kinds it renders as `null`,
 * named here so the ticker skips them rather than drawing a blank. The case in `LogLine`
 * points back here: keep the two lists in step.
 */
export function logShows(entry: LogEntry): boolean {
  return entry.kind !== 'game_start' && entry.kind !== 'terrain_placed'
}

export type CombatEntry = Extract<LogEntry, { kind: 'combat_resolved' }>
export type ManeuverEntry = Extract<LogEntry, { kind: 'maneuver_contested' }>

export type RollStep =
  /** A roll nobody resists, drawn whole by `LogLine`. */
  | { readonly kind: 'roll'; readonly entry: LogEntry }
  | { readonly kind: 'attack'; readonly entry: CombatEntry }
  /** The saves and what the exchange came to -- or the outcome alone, with no save roll. */
  | { readonly kind: 'resist'; readonly entry: CombatEntry }
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
  /** A roll still parked while somebody decides about it: shown as it landed. */
  | { readonly kind: 'live'; readonly roll: TableRoll }

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

const resolves = (die: DieRoll): boolean => (die.effects ?? []).some((effect) => RESOLVES.has(effect.kind))

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
  return logSteps(entries, human, ownerOf, []).steps
}

/**
 * `rollSteps`, skipping the parts of the next exchange already shown live. Also returns
 * the shown kinds whose entry is not logged yet: their exchange is still paused.
 */
function logSteps(
  entries: readonly LogEntry[],
  human: PlayerId,
  ownerOf: OwnerOf,
  shown: readonly LiveKind[],
): { readonly steps: readonly RollStep[]; readonly unlogged: readonly LiveKind[] } {
  let unlogged = shown
  const seen = (kind: LiveKind): boolean => unlogged.includes(kind)
  const steps: RollStep[] = []
  // SAI resolutions logged ahead of the exchange that rolled them, waiting for it.
  let waiting: LogEntry[] = []

  const saiSteps = (dice: readonly DieRoll[]): readonly RollStep[] =>
    dice.filter(resolves).flatMap((die): readonly RollStep[] => {
      const name = die.face.icon === 'SAI' ? die.face.sai : null
      const resolved = waiting.filter((entry) => name !== null && resolutionOf(entry) === name)
      waiting = waiting.filter((entry) => !resolved.includes(entry))
      // Your own, already answered: only what it rolled is news. See the header.
      if (ownerOf(die.unitId) === human) {
        return resolved.filter((entry) => NEWS.has(entry.kind)).map((entry) => ({ kind: 'roll', entry }))
      }
      return [{ kind: 'sai', die, resolved }]
    })

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as LogEntry

    // Spells: a run of spell lines that names at least one spell. The consequences come
    // first in the log, so the run is found by looking ahead from its first line.
    if (SPELL_RUN.has(entry.kind)) {
      let end = i
      while (end < entries.length && SPELL_RUN.has((entries[end] as LogEntry).kind)) end++
      const run = entries.slice(i, end)
      const named = run.find(namesSpell)
      if (named !== undefined) {
        if (named.player !== human) {
          steps.push({ kind: 'spells', entries: spellBySpell(run) })
        } else {
          // Your own: no stop for the casting, but a roll inside it still is one.
          for (const inner of run) if (WHOLE_ROLLS.has(inner.kind)) steps.push({ kind: 'roll', entry: inner })
        }
        i = end - 1
        continue
      }
    }

    if (resolutionOf(entry) !== null) {
      waiting.push(entry)
      continue
    }

    switch (entry.kind) {
      // The first of these after a live stop is the exchange that stop was parked in:
      // nothing else can be written down while it is paused.
      case 'combat_resolved':
        if (!seen('attack')) steps.push({ kind: 'attack', entry })
        steps.push(...saiSteps(entry.attackDice), { kind: 'resist', entry })
        unlogged = unlogged.filter((kind) => kind !== 'attack' && kind !== 'save')
        break
      case 'maneuver_contested':
        if (!seen('maneuver')) steps.push({ kind: 'maneuver', entry })
        steps.push(...saiSteps(entry.marcherDice), { kind: 'counter_maneuver', entry })
        unlogged = unlogged.filter((kind) => kind !== 'maneuver' && kind !== 'counter_maneuver')
        break
      case 'magic_rolled':
        if (!seen('attack')) steps.push({ kind: 'roll', entry })
        steps.push(...saiSteps(entry.dice))
        unlogged = unlogged.filter((kind) => kind !== 'attack')
        break
      // A Rise from the Ashes that rolled nothing -- no Phoenix died -- is not a roll.
      case 'units_risen':
        if ((entry.dice?.length ?? 0) > 0) steps.push({ kind: 'roll', entry })
        break
      default:
        if (WHOLE_ROLLS.has(entry.kind)) steps.push({ kind: 'roll', entry })
    }
  }

  // Resolutions whose exchange is not in the log yet -- it is paused on a decision --
  // are shown where they are rather than held back past it. Only the rolls among them
  // are stops; the rest are on the board.
  for (const entry of waiting) if (entry.kind === 'sai_sub_roll') steps.push({ kind: 'roll', entry })
  return { steps, unlogged }
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

/**
 * Every stop from the cursor on: the log's, then any roll still parked that has not
 * been shown. This is what `useGame` walks.
 */
export function rollStops(state: GameState, cursor: RollCursor, human: PlayerId): readonly RollStep[] {
  const { steps, unlogged } = logSteps(state.log.slice(cursor.log), human, ownerIn(state), cursor.shown ?? [])
  const live = parked(state)
    .filter(({ kind }) => !unlogged.includes(kind))
    .map(({ roll }): RollStep => ({ kind: 'live', roll }))
  return [...steps, ...live]
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
