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
 * **The enemy's spells are a stop**: what was cast, and what each one did and where,
 * which is the lines after each `spell_cast` until the next. Your own are not -- you
 * just chose them -- though a roll inside them (the enemy's saves against a Hailstorm)
 * still is.
 *
 * Entries that are none of these -- a march begun, a terrain turned, a unit killed --
 * are not stops. They are on the board as they happen, and in the ticker.
 */
import type { DieRoll } from '../../engine/roll'
import type { LogEntry, PlayerId } from '../../engine/types'

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
])

const resolves = (die: DieRoll): boolean => (die.effects ?? []).some((effect) => RESOLVES.has(effect.kind))

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
export function rollSteps(entries: readonly LogEntry[], human: PlayerId): readonly RollStep[] {
  const steps: RollStep[] = []
  // SAI resolutions logged ahead of the exchange that rolled them, waiting for it.
  let waiting: LogEntry[] = []

  const saiSteps = (dice: readonly DieRoll[]): readonly RollStep[] =>
    dice.filter(resolves).map((die) => {
      const name = die.face.icon === 'SAI' ? die.face.sai : null
      const resolved = waiting.filter((entry) => name !== null && resolutionOf(entry) === name)
      waiting = waiting.filter((entry) => !resolved.includes(entry))
      return { kind: 'sai', die, resolved }
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
      case 'combat_resolved':
        steps.push({ kind: 'attack', entry }, ...saiSteps(entry.attackDice), { kind: 'resist', entry })
        break
      case 'maneuver_contested':
        steps.push({ kind: 'maneuver', entry }, ...saiSteps(entry.marcherDice), {
          kind: 'counter_maneuver',
          entry,
        })
        break
      case 'magic_rolled':
        steps.push({ kind: 'roll', entry }, ...saiSteps(entry.dice))
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
  return steps
}

/**
 * Where the player is in the rolls: the log index the pending ones start at, and how
 * many of the steps from there have been shown. `{ log: n, step: 0 }` with nothing
 * after `n` means nothing is waiting.
 */
export interface RollCursor {
  readonly log: number
  readonly step: number
}

/** The cursor after one more step is seen -- or past everything, once all have been. */
export function advanceCursor(log: readonly LogEntry[], cursor: RollCursor, human: PlayerId): RollCursor {
  const steps = rollSteps(log.slice(cursor.log), human)
  return cursor.step + 1 < steps.length ? { log: cursor.log, step: cursor.step + 1 } : { log: log.length, step: 0 }
}
