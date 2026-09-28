/**
 * The live-rules fuzz (v2 Phase 0b): random self-play under `V1_RULES`, which is what
 * the app plays. 200 games in the default suite, and 1000 behind `npm run fuzz`
 * (`vitest --mode fuzz`), which runs this file alone.
 *
 * It closes the gap `PLAN-V1.md` *Risks* carried for five phases: the 1000-game net in
 * `ai.test.ts` runs `V0_RULES`, the one configuration nobody plays, while the live
 * rules had only 200-game fuzzes, each over one rung. That net stays where it is -- it
 * is `V0_RULES`' guard, the goldens' rules -- and this one guards what is played,
 * before v2 adds twenty SAIs, eleven spells and eight abilities on top of it.
 *
 * **What it catches is the fuzz's usual narrow list**: a deadlock (`stuck`), a
 * `validateState` breach on any intermediate state, and a throw on any path
 * `RandomAI` can reach. Not rule correctness.
 *
 * **The counters are what make a clean run mean something**, and most of them cannot
 * go stale:
 * - `DECISIONS` and `LOG` are keyed by `GameAction['kind']` and `LogEntry['kind']`, so a
 *   kind added later is a compile error here until somebody says whether this fuzz
 *   reaches it -- a new rule adds a trigger counter whether or not its author
 *   remembered to.
 * - Every SAI on any die in the data must be rolled, and every spell the rules
 *   resolve must be cast. Both are read from the data, so a species phase that adds a
 *   die or a spell tightens this on its own: random forces draw every species.
 * - `RULES` is the hand-kept rest: branches inside one kind, which no type can list.
 *
 * Each expectation is a tier. `every` fires in the default 200; `full` only in the
 * 1000 (under five in the 200, where one change to dice consumption could zero it);
 * `elsewhere` is never reached at random, and names the test that reaches it instead.
 *
 * Every game must end: the cap is twice the longest game measured, so a game that
 * reaches it has changed, and a counter under a capped game would be a lie by omission.
 *
 * Measured when it landed: 200 games in about 14 seconds, 1000 in about 55, with
 * every state validated.
 */
import { describe, expect, it } from 'vitest'

import { UNIT_TYPES } from '../data/load'
import { SPELLS } from '../data/spells'
import { resolvesSpell } from '../engine/spells'
import { BESTIARY_FORCES, FORCE_SETS, STARTER_FORCES, setupGame, type ForceSpec } from '../engine/setup'
import { dragonDie } from '../data/load'
import { V1_RULES, forceSize, type GameAction, type LogEntry } from '../engine/types'

import { randomAi } from './random'
import { runGame } from './run'

const FULL = import.meta.env.MODE === 'fuzz'
const GAMES = FULL ? 1000 : 200
/**
 * Twice the longest game measured: 17,074 decisions, the same game in the 200 and the
 * 1000. The median is about 2,000. Random play runs long because nobody concedes, which
 * is not a finding; a game past this is one that has changed.
 */
const MAX_DECISIONS = 35_000

type Reach = 'every' | 'full' | { readonly elsewhere: string }

const DECISIONS: Readonly<Record<GameAction['kind'], Reach>> = {
  roll_off_choice: 'every',
  choose_frontier: 'every',
  choose_march_army: 'every',
  choose_maneuver: 'every',
  contest_maneuver: 'every',
  choose_direction: 'every',
  choose_action: 'every',
  choose_missile_target: 'every',
  choose_counter_attack: 'every',
  assign_damage: 'every',
  sai_target: 'every',
  sai_target_army: 'every',
  sai_promote: 'every',
  sai_move: 'every',
  reinforce: 'every',
  retreat: 'every',
  rapid_growth: 'every',
  accelerated_growth: 'every',
  eighth_face_city: 'every',
  eighth_face_temple: 'every',
  temple_bury: 'every',
  announce_spells: 'every',
  flashfire: 'every',
  dispel_magic: 'every',
  spell_move: 'every',
  spell_summon: 'every',
  dragon_breath: 'every',
  dragon_allocate: 'every',
  dragon_treasure: 'full',
  // Three dragon decisions need two dragons in one place, or dragons at two terrains
  // at once. Summon Dragon is the only way onto the board under the live rules, and a
  // thousand random games never put the second one there.
  dragon_order: { elsewhere: "dragons.test.ts, 'lets the marching player order two terrains'" },
  dragon_target: { elsewhere: "dragons.test.ts, 'raises the declaration through the real machine'" },
  dragon_damage_split: { elsewhere: "dragons.test.ts, 'asks when two same-element dragons both go for the army'" },
}

const LOG: Readonly<Record<LogEntry['kind'], Reach>> = {
  game_start: 'every',
  roll_off: 'every',
  roll_off_decided: 'every',
  forces_drawn: 'every',
  // The roll-off choice replaces it: `order_of_play` is the rung below, where the
  // winner marches first without being asked.
  order_of_play: { elsewhere: "rolloff.test.ts and setup.test.ts, below the roll-off choice's rung" },
  terrain_placed: 'every',
  dragons_drawn: 'every',
  dragon_attack: 'every',
  dragon_damage: 'every',
  dragon_breath: 'every',
  dragon_breath_effect: 'every',
  dragon_roll: 'every',
  dragon_home: 'every',
  march_begin: 'every',
  march_skipped: 'every',
  maneuver_declared: 'every',
  maneuver_allowed: 'every',
  maneuver_contested: 'every',
  rapid_growth: 'every',
  terrain_moved: 'every',
  terrain_captured: 'every',
  terrain_lost: 'every',
  reinforced: 'every',
  retreated: 'every',
  air_flight: 'every',
  action_chosen: 'every',
  action_skipped: 'every',
  combat_resolved: 'every',
  units_killed: 'every',
  sai_resolved: 'every',
  sai_sub_roll: 'every',
  units_promoted: 'every',
  units_recruited: 'every',
  units_moved: 'every',
  units_buried: 'every',
  effect_cast: 'every',
  units_risen: 'every',
  replanting: 'every',
  counter_declined: 'every',
  magic_rolled: 'every',
  spell_cast: 'every',
  spell_fizzled: 'full',
  flash_flood: 'every',
  cantrip: 'every',
  dispel_magic: 'every',
  confused: 'every',
  flashfire: 'every',
  units_regrown: 'every',
  thorns: 'full',
  spell_saves: 'every',
  units_resurrected: 'every',
  dragon_summoned: 'every',
  effects_expired: 'every',
  counter_suppressed: 'every',
  turn_end: 'every',
  victory: 'every',
}

/**
 * Branches inside one kind. The keys are the tallies `tally` writes below; a new
 * branch worth guarding gets a key here and a line there.
 */
const RULES: Readonly<Record<string, Reach>> = {
  // Both prizes of the roll-off, and both ways to win.
  'took:first_turn': 'every',
  'took:frontier': 'every',
  'victory:captures': 'every',
  'victory:elimination': 'every',
  // Every SAI that is a decision rather than a number, by the entry it leaves.
  'resolved:Bullseye': 'every',
  'resolved:Choke': 'every',
  'resolved:Confuse': 'every',
  'resolved:Double Strike': 'every',
  'resolved:Firecloud': 'every',
  'resolved:Flame': 'every',
  'resolved:Seize': 'every',
  'resolved:Smother': 'every',
  'effect:Sleep': 'every',
  'effect:Galeforce': 'every',
  // The eighth face: a missile at a Reserve Army is Tower's; City and Temple are
  // their own decisions above.
  tower_reserve: 'every',
  'promoted:city': 'every',
  'buried:temple': 'every',
  // Dragons slain and dragon treasure both promote.
  'promoted:dragon_slain': 'full',
  'promoted:dragon_treasure': 'full',
  // The species abilities, each both ways where it has two.
  replant_rooted: 'every',
  replant_missed: 'every',
  flaming_shields: 'every',
  growth_taken: 'every',
  growth_declined: 'every',
  // v2 Phase 2: a rolled force may mix species, and one in five here does.
  mixed_force: 'every',
}

function tally(games: number): { counts: Map<string, number>; stuck: number; capped: number; longest: number } {
  const counts = new Map<string, number>()
  const bump = (key: string, by = 1): void => {
    counts.set(key, (counts.get(key) ?? 0) + by)
  }
  const mirrors = Object.entries(FORCE_SETS)
    .filter(([name]) => name !== 'starter' && name !== 'bestiary')
    .map(([, forces]) => forces)
  let stuck = 0
  let capped = 0
  let longest = 0

  for (let i = 0; i < games; i++) {
    const seed = i + 1
    // Rolled forces twice in five, because they are what reaches every die and every
    // species in the data -- one of the two mixed (v2 Phase 2), since a mixed force
    // is where Phase 1's per-unit species and per-species magic pool actually run.
    // The named sets once each put the bestiary's 25 SAIs and the monster mirrors'
    // concentrated faces on the board every few games.
    const forces: ForceSpec = [
      { kind: 'random' } as const,
      STARTER_FORCES,
      BESTIARY_FORCES,
      mirrors[i % mirrors.length] as ForceSpec,
      { kind: 'random', mixed: true } as const,
    ][i % 5] as ForceSpec
    const setup = { seed, forces, ruleSet: V1_RULES }
    const result = runGame({
      setup,
      players: { p1: randomAi, p2: randomAi },
      aiSeed: 300_000 + seed,
      maxDecisions: MAX_DECISIONS,
      validate: true,
    })
    if (result.stoppedBecause === 'stuck') stuck += 1
    if (result.stoppedBecause === 'cap') capped += 1
    longest = Math.max(longest, result.decisions)

    // Force size is derived, not stored (`forceSize`), which is sound only while it
    // cannot change. A game that ends at another size has found the rule that moves it.
    const opening = setupGame(setup)
    for (const player of ['p1', 'p2'] as const) {
      expect(forceSize(result.state, player), `seed ${seed}: ${player}'s force size moved`).toBe(
        forceSize(opening, player),
      )
    }

    for (const action of result.record.actions) {
      bump(`decision:${action.kind}`)
      if (action.kind === 'rapid_growth') bump(action.unitIds.length > 0 ? 'growth_taken' : 'growth_declined')
    }
    for (const entry of result.state.log) {
      bump(`log:${entry.kind}`)
      rolledSais(entry, bump)
      switch (entry.kind) {
        case 'forces_drawn':
          if (entry.species.p1.length > 1 || entry.species.p2.length > 1) bump('mixed_force')
          break
        case 'roll_off_decided':
          bump(`took:${entry.took}`)
          break
        case 'victory':
          bump(`victory:${entry.reason}`)
          break
        case 'sai_resolved':
          bump(`resolved:${entry.sai}`)
          break
        case 'effect_cast':
          bump(`effect:${entry.source}`)
          break
        case 'spell_cast':
          bump(`spell:${entry.spell}`)
          break
        case 'dragon_breath':
          bump(`breath:${entry.element}`)
          break
        case 'dragons_drawn':
          for (const die of entry.pool) bump(`drawn:${dragonDie(die).element}`)
          break
        case 'units_promoted':
          if (entry.source !== undefined) bump(`promoted:${entry.source}`)
          break
        case 'units_buried':
          if (entry.source !== undefined) bump(`buried:${entry.source}`)
          break
        case 'combat_resolved':
          if (entry.action === 'missile' && entry.defenderSlot === 'reserve') bump('tower_reserve')
          if (entry.flamingShields !== undefined) bump('flaming_shields')
          break
        case 'replanting':
          bump('replant_rooted', entry.rooted.length)
          bump('replant_missed', entry.dice.length - entry.rooted.length)
          break
      }
    }
  }
  return { counts, stuck, capped, longest }
}

/** Every SAI face in any roll an entry carries, found the way `digestState` finds dice. */
function rolledSais(value: unknown, bump: (key: string) => void): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) rolledSais(item, bump)
    return
  }
  const record = value as Record<string, unknown>
  const face = record['face'] as { readonly icon?: unknown; readonly sai?: unknown } | undefined
  if (typeof record['unitId'] === 'string' && typeof record['faceIndex'] === 'number' && face?.icon === 'SAI') {
    bump(`rolled:${String(face.sai)}`)
  }
  for (const nested of Object.values(record)) rolledSais(nested, bump)
}

function expectReached(counts: ReadonlyMap<string, number>, key: string, reach: Reach): void {
  if (typeof reach === 'object') return
  if (reach === 'full' && !FULL) return
  expect(counts.get(key) ?? 0, `${key} never fired in ${GAMES} games, so this run proved nothing about it`)
    .toBeGreaterThan(0)
}

describe('the live-rules fuzz', () => {
  it(`plays ${GAMES} V1_RULES games, and every rule it can reach fires`, { timeout: FULL ? 600_000 : 120_000 }, () => {
    const { counts, stuck, capped, longest } = tally(GAMES)

    expect(stuck, 'a game ended with no winner and nothing pending').toBe(0)
    expect(capped, `a game ran ${MAX_DECISIONS} decisions; longest was ${longest}`).toBe(0)

    for (const [kind, reach] of Object.entries(DECISIONS)) expectReached(counts, `decision:${kind}`, reach)
    for (const [kind, reach] of Object.entries(LOG)) expectReached(counts, `log:${kind}`, reach)
    for (const [key, reach] of Object.entries(RULES)) expectReached(counts, key, reach)

    // From the data: every SAI any die carries, and every spell the rules resolve.
    const sais = new Set(UNIT_TYPES.flatMap((u) => u.faces.flatMap((f) => (f.icon === 'SAI' ? [f.sai] : []))))
    for (const sai of sais) expectReached(counts, `rolled:${sai}`, 'every')
    const spells = SPELLS.filter((s) => resolvesSpell(s.id, V1_RULES))
    expect(spells.length).toBe(SPELLS.length)
    for (const spell of spells) expectReached(counts, `spell:${spell.id}`, 'every')

    // Every element a dragon was drawn in has breathed. The element set comes off the
    // board rather than a list, so Death joins it with the first species to draw one.
    const drawn = [...counts.keys()].filter((k) => k.startsWith('drawn:')).map((k) => k.slice('drawn:'.length))
    expect(drawn.length).toBeGreaterThan(0)
    for (const element of drawn) expectReached(counts, `breath:${element}`, 'full')
  })
})
