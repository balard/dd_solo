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

import { PLAYABLE_UNITS } from '../engine/playable'
import { SPELLS } from '../data/spells'
import { resolvesSpell } from '../engine/spells'
import {
  BESTIARY_FORCES,
  FORCE_SETS,
  STARTER_FORCES,
  isMirror,
  setupGame,
  type ForceSpec,
} from '../engine/setup'
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
  sai_regenerate: 'every',
  foul_stench: 'every',
  // Illusion (v2 Phase 8d): reached since the 8e flip.
  sai_illusion: 'every',
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
  // Charge (v2 Phase 6e): a defender with IDs to split, against a Behemoth's Charge face.
  // Every random game since 6e until the Goblins diluted the draws and the mirror
  // rotation (v2 Phase 7e): 0 in 200, 5 in 1000.
  charge_allocate: 'full',
  dragon_treasure: 'full',
  // Three dragon decisions need two dragons in one place, or dragons at two terrains
  // at once. Summon Dragon is the only way onto the board under the live rules, and a
  // thousand random games never put the second one there.
  dragon_order: { elsewhere: "dragons.test.ts, 'lets the marching player order two terrains'" },
  dragon_target: { elsewhere: "dragons.test.ts, 'raises the declaration through the real machine'" },
  dragon_damage_split: { elsewhere: "dragons.test.ts, 'asks when two same-element dragons both go for the army'" },
  // No AI concedes (v2 Phase 3e): whether one ever should is a v3 encounter question.
  concede: { elsewhere: 'concede.test.ts' },
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
  units_regenerated: 'every',
  units_sent_home: 'every',
  foul_stench: 'every',
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
  'victory:concession': { elsewhere: 'concede.test.ts' },
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
  // The Coral Elves (v2 Phase 5): three by the entry they leave, Ferry by its move, and
  // Wave by the step it writes into the other army's roll.
  'resolved:Entangle': 'every',
  'resolved:Swallow': 'every',
  // A Leviathan face in ten, in a melee attack that earns a save roll, and a defender's
  // ID on it: too rare for 200 games.
  'resolved:Hypnotic Glare': 'full',
  'moved:Ferry': 'every',
  'wave:saves': 'every',
  'wave:maneuver': 'every',
  // The Dwarves (v2 Phase 6): Roar, Stomp and Bash by the entry they leave, and the
  // halves that leave one of their own.
  'resolved:Roar': 'every',
  // Stomp resolves only from a Dwarf's maneuver; diluted by the sixth species (v2 Phase
  // 8e) it fell out of 200 games -- 16 resolved, 9 burials in 1000.
  'resolved:Stomp': 'full',
  'resolved:Bash': 'every',
  stomp_burial: 'full',
  // A Behemoth's army attacked by a dragon, rolling its Bash face: not in 1000 games.
  dragon_bash: { elsewhere: 'dwarves.test.ts' },
  charge: 'every',
  // The Goblins (v2 Phase 7): the targeting four by the entry they leave, Net and Stun
  // by the status they write, Screech by its step, and Regenerate both ways.
  'resolved:Poison': 'every',
  'resolved:Net': 'every',
  'resolved:Stun': 'every',
  'effect:Net': 'every',
  // Stun resolves within 200 games, but a die failing its maneuver to it does not.
  'effect:Stun': 'full',
  poison_burial: 'every',
  screech: 'every',
  'regenerate:units': 'every',
  'regenerate:saves': 'every',
  swamp_mastery: 'every',
  // Soiled Ground (v2 Phase 7e): a die killed where it stands rolls its burial check.
  // Cast 17 times in 1000 random games, and no die died on the soiled terrain before it
  // wore off -- random play casts it anywhere -- so the check is driven by name.
  soiled_burial: { elsewhere: 'goblins.test.ts' },
  // Foul Stench benching the whole army, so no counter is offered: the common case in
  // random play, where a Goblin DUA fills fast and a defending army is often small.
  foul_stench_no_counter: 'every',
  // The Lava Elves (v2 Phase 8): Charm and Web by the entry they leave, Web, Cloak and
  // Illusion by the effect they write, Stone by its face (below, from the data).
  // One face on one monster, and only a melee attack: 9 resolved in 1000 games. In the
  // Beholder mirror 141 of 145 melee-attack Charms resolve, the rest finding nothing.
  'resolved:Charm': 'full',
  'resolved:Web': 'every',
  'effect:Web': 'every',
  'effect:Cloak': 'every',
  'effect:Illusion': 'every',
  volcanic_adaptation: 'every',
  cursed_bullets: 'every',
  // The Lava Elves' spells (v2 Phase 8f), past being cast: a Wave converting a roll's
  // magic, and a die fleeing Fearful Flames' second save. A Wave is cast by the army that
  // holds the magic dice, which has already marched, so a random game rarely rolls a magic
  // face into the melee or missile it reaches: 4 conversions from 1006 casts in 1000 games.
  necromantic_wave: 'full',
  fearful_flight: 'every',
  // Each of these is a branch random play reaches too rarely to rely on, so a named test
  // drives it: a Web dropped at a Reserve Army, an Illusion against a Tower's missile at
  // Reserves and against a volley, a curse that a volley cannot make, a Charm on a Charge.
  web_tower_drop: { elsewhere: "lava.test.ts, 'does nothing in a missile attack on a Reserve Army'" },
  illusion_tower: { elsewhere: "lava.test.ts, 'takes a Reserve Army out of a Tower's missile targets'" },
  illusion_volley: { elsewhere: "lava.test.ts, 'refuses a Defensive Volley at an Illusioned marching army'" },
  cursed_counter: { elsewhere: "lava.test.ts, 'curses nothing on a Defensive Volley'" },
  charm_charge: { elsewhere: "lava.test.ts, 'adds the charmed dice's melee to a Charge'" },
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
  coastal_dodge: 'every',
  defensive_volley: 'every',
  mountain_mastery: 'every',
  dwarven_might: 'every',
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
  // By what a mirror is, not by leaving out the other names: the built examples joined
  // `FORCE_SETS` in v2 Phase 3e, and a filter by exclusion would have taken them in.
  const mirrors = Object.values(FORCE_SETS).filter(isMirror)
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
          if (entry.saveMath?.steps.some((step) => step.source === 'Wave')) bump('wave:saves')
          if (entry.saveMath?.steps.some((step) => step.source === 'Screech')) bump('screech')
          if (entry.saveMath?.notes.some((note) => note.includes('Coastal Dodge'))) bump('coastal_dodge')
          if (entry.saveMath?.notes.some((note) => note.includes('Volcanic Adaptation'))) bump('volcanic_adaptation')
          if (entry.cursed !== undefined) bump('cursed_bullets')
          if (entry.attackMath?.notes.some((note) => note.includes('Necromantic Wave'))) bump('necromantic_wave')
          if (entry.isCounter && entry.action === 'missile') bump('defensive_volley')
          if (entry.charge !== undefined) bump('charge')
          if (entry.isCounter && entry.attackMath?.notes.some((note) => note.includes('Dwarven Might'))) {
            bump('dwarven_might')
          }
          break
        case 'maneuver_contested':
          if (entry.defenderMath?.steps.some((step) => step.source === 'Wave')) bump('wave:maneuver')
          if (
            [entry.marcherMath, entry.defenderMath].some((math) =>
              math?.notes.some((note) => note.includes('Mountain Mastery')),
            )
          ) {
            bump('mountain_mastery')
          }
          if (
            [entry.marcherMath, entry.defenderMath].some((math) =>
              math?.notes.some((note) => note.includes('Swamp Mastery')),
            )
          ) {
            bump('swamp_mastery')
          }
          break
        case 'sai_sub_roll':
          if (entry.source === 'Stomp' && entry.fate === 'bury') bump('stomp_burial')
          if (entry.source === 'Poison' && entry.fate === 'bury') bump('poison_burial')
          if (entry.source === 'Soiled Ground') bump('soiled_burial')
          if (entry.source === 'Fearful Flames' && entry.fate === 'flee' && entry.escaped.length === 0) bump('fearful_flight')
          break
        case 'units_regenerated':
          bump(entry.unitIds.length > 0 ? 'regenerate:units' : 'regenerate:saves')
          break
        case 'foul_stench':
          if (entry.noCounter === true) bump('foul_stench_no_counter')
          break
        case 'dragon_damage':
          if (entry.bashed !== undefined) bump('dragon_bash')
          break
        case 'units_moved':
          bump(`moved:${entry.sai}`)
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

    // From the data: every SAI any playable die carries, and every spell the rules
    // resolve. Playable, because a species transcribed ahead of its rules is in the data
    // and cannot be drawn -- it joins this list the slice it becomes playable.
    const sais = new Set(PLAYABLE_UNITS.flatMap((u) => u.faces.flatMap((f) => (f.icon === 'SAI' ? [f.sai] : []))))
    for (const sai of sais) expectReached(counts, `rolled:${sai}`, 'every')
    const spells = SPELLS.filter((s) => resolvesSpell(s.id, V1_RULES))
    expect(spells.length).toBe(SPELLS.length)
    for (const spell of spells) expectReached(counts, `spell:${spell.id}`, 'every')

    // Every element a dragon was drawn in has breathed. The element set comes off the
    // board rather than a list, so Death joins it with the first species to draw one.
    const drawn = [...counts.keys()].filter((k) => k.startsWith('drawn:')).map((k) => k.slice('drawn:'.length))
    expect(drawn.length).toBeGreaterThan(0)
    // Death (v2 Phase 7e) needs a Death force to summon a Death dragon that then rolls its
    // breath: reached in one 1000-game run and missed by the next, so it has a named test.
    for (const element of drawn) {
      expectReached(counts, `breath:${element}`, element === 'death' ? { elsewhere: 'dragons.test.ts' } : 'full')
    }
  })
})
