import { describe, expect, it } from 'vitest'

import { rngFrom } from '../engine/rng'
import {
  BESTIARY_FORCES,
  FORCE_SETS,
  STARTER_FORCES,
  isMirror,
  setupGame,
  type ForceSpec,
} from '../engine/setup'
import {
  SPECIES_RULES,
  V0_RULES,
  V1_RULES,
  type GameAction,
  type GameState,
  type Location,
  type Pending,
  type PlayerId,
  type TerrainFace,
  type TerrainSlot,
  type UnitInstance,
} from '../engine/types'

import { greedyAi } from './greedy'
import { passiveAi } from './passive'
import { randomAi } from './random'
import { runGame } from './run'

const at = (slot: TerrainSlot): Location => ({ kind: 'terrain', slot })
const reserve: Location = { kind: 'reserve' }
const dua: Location = { kind: 'dua' }

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner?: PlayerId
  readonly at: Location
}

/** A real setup with its roster and faces replaced. Every terrain is a Tower die so
 *  the face actions are the Swampland's: 1-2 magic, 3-4 missile, 5-7 melee. */
function board(
  specs: readonly Spec[],
  faces: Partial<Record<TerrainSlot, { face: TerrainFace; capturedBy?: PlayerId }>> = {},
): GameState {
  const base = setupGame({
    seed: 1,
    forces: STARTER_FORCES,
    ruleSet: SPECIES_RULES,
    terrains: { p1_home: 'swampland_tower', frontier: 'swampland_tower', p2_home: 'swampland_tower' },
  })
  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = { id: spec.id, typeId: spec.typeId, owner: spec.owner ?? 'p1', location: spec.at }
  }
  const terrains = { ...base.terrains }
  for (const [slot, setting] of Object.entries(faces) as [TerrainSlot, { face: TerrainFace; capturedBy?: PlayerId }][]) {
    terrains[slot] = { ...terrains[slot], face: setting.face, capturedBy: setting.capturedBy ?? null }
  }
  return { ...base, units, terrains, effects: [] }
}

const answer = (state: GameState, pending: Pending): GameAction =>
  greedyAi.decide(state, pending, rngFrom(1))[0]

describe('GreedyAI: the march', () => {
  it('marches whenever an army can, even one with nothing to do', () => {
    const state = board([{ id: 'a', typeId: 'treefolk.oakling', at: at('frontier') }])
    const action = answer(state, { kind: 'choose_march_army', player: 'p1', options: ['frontier'] })
    expect(action).toEqual({ kind: 'choose_march_army', army: 'frontier' })
  })

  it('marches the army that can walk a terrain home before one with nothing in reach', () => {
    const state = board(
      [
        { id: 'a', typeId: 'treefolk.oak', at: at('frontier') },
        { id: 'b', typeId: 'treefolk.oak', at: at('p1_home') },
      ],
      { frontier: { face: 7 }, p1_home: { face: 2 } },
    )
    const action = answer(state, { kind: 'choose_march_army', player: 'p1', options: ['p1_home', 'frontier'] })
    expect(action).toEqual({ kind: 'choose_march_army', army: 'frontier' })
  })

  it('maneuvers from 7 to capture the eighth face', () => {
    const state = board([{ id: 'a', typeId: 'treefolk.oak', at: at('frontier') }], { frontier: { face: 7 } })
    expect(answer(state, { kind: 'choose_maneuver', player: 'p1', slot: 'frontier' })).toEqual({
      kind: 'choose_maneuver',
      maneuver: true,
    })
    expect(
      answer(state, { kind: 'choose_direction', player: 'p1', slot: 'frontier', options: ['up', 'down'] }),
    ).toEqual({ kind: 'choose_direction', direction: 'up' })
  })

  it('never maneuvers off an eighth face it holds', () => {
    const state = board([{ id: 'a', typeId: 'treefolk.oak', at: at('frontier') }], {
      frontier: { face: 8, capturedBy: 'p1' },
    })
    expect(answer(state, { kind: 'choose_maneuver', player: 'p1', slot: 'frontier' })).toEqual({
      kind: 'choose_maneuver',
      maneuver: false,
    })
  })

  it("knocks the enemy off their eighth face, even into a contest it may lose", () => {
    const state = board(
      [
        { id: 'a', typeId: 'treefolk.oakling', at: at('frontier') },
        { id: 'e', typeId: 'treefolk.redwood', owner: 'p2', at: at('frontier') },
      ],
      { frontier: { face: 8, capturedBy: 'p2' } },
    )
    expect(answer(state, { kind: 'choose_maneuver', player: 'p1', slot: 'frontier' })).toEqual({
      kind: 'choose_maneuver',
      maneuver: true,
    })
  })

  it('attacks rather than casting nothing, and never passes while anything is legal', () => {
    // An eighth face offers all three. Under real spells magic is worth nothing until
    // greedy can score spells, so it melees the army opposite.
    const state = board(
      [
        { id: 'a', typeId: 'treefolk.oak_lord', at: at('frontier') },
        { id: 'e', typeId: 'firewalkers.guardian', owner: 'p2', at: at('frontier') },
      ],
      { frontier: { face: 8, capturedBy: 'p1' } },
    )
    expect(
      answer(state, { kind: 'choose_action', player: 'p1', slot: 'frontier', legal: ['melee', 'missile', 'magic'] }),
    ).toEqual({ kind: 'choose_action', action: 'melee' })

    const alone = board([{ id: 'a', typeId: 'treefolk.oak_lord', at: at('frontier') }])
    expect(
      answer(alone, { kind: 'choose_action', player: 'p1', slot: 'frontier', legal: ['magic'] }),
    ).toEqual({ kind: 'choose_action', action: 'magic' })
  })

  it('contests and counter-attacks, which are free', () => {
    const state = board([{ id: 'a', typeId: 'treefolk.oak', at: at('frontier') }])
    expect(answer(state, { kind: 'contest_maneuver', player: 'p1', slot: 'frontier' })).toEqual({
      kind: 'contest_maneuver',
      contest: true,
    })
    expect(answer(state, { kind: 'choose_counter_attack', player: 'p1', slot: 'frontier' })).toEqual({
      kind: 'choose_counter_attack',
      counter: true,
    })
  })
})

describe('GreedyAI: losses and targets', () => {
  it('loses {2,2} rather than the 3 to 4 damage -- the section 6 example', () => {
    const state = board([
      { id: 'lord', typeId: 'treefolk.oak_lord', at: at('frontier') },
      { id: 'o1', typeId: 'treefolk.oak', at: at('frontier') },
      { id: 'o2', typeId: 'treefolk.oak', at: at('frontier') },
    ])
    expect(answer(state, { kind: 'assign_damage', player: 'p1', slot: 'frontier', damage: 4 })).toEqual({
      kind: 'assign_damage',
      unitIds: ['o1', 'o2'],
    })
  })

  it('sleeps the monster, not the small die', () => {
    const state = board([
      { id: 'small', typeId: 'firewalkers.guardian', owner: 'p2', at: at('frontier') },
      { id: 'big', typeId: 'firewalkers.salamander', owner: 'p2', at: at('frontier') },
    ])
    const action = answer(state, {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Sleep',
      target: 'p2',
      slot: 'frontier',
      limit: { kind: 'one' },
      remaining: 1,
    })
    expect(action).toEqual({ kind: 'sai_target', unitIds: ['big'] })
  })

  it('takes the dearest maximal set with a Flame', () => {
    const state = board([
      { id: 'g1', typeId: 'firewalkers.guardian', owner: 'p2', at: at('frontier') },
      { id: 'w', typeId: 'firewalkers.watcher', owner: 'p2', at: at('frontier') },
    ])
    const action = answer(state, {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Flame',
      target: 'p2',
      slot: 'frontier',
      limit: { kind: 'health', budget: 2 },
      remaining: 1,
    })
    expect(action).toEqual({ kind: 'sai_target', unitIds: ['w'] })
  })
})

describe('GreedyAI: friendly offers', () => {
  it('always promotes when the City offers it', () => {
    const state = board([
      { id: 'a', typeId: 'treefolk.oak', at: at('p1_home') },
      { id: 'dead', typeId: 'treefolk.oak_lord', at: dua },
      { id: 'small', typeId: 'treefolk.oakling', at: dua },
    ])
    const action = answer(state, {
      kind: 'eighth_face_city',
      player: 'p1',
      slot: 'p1_home',
      recruits: ['small'],
      promotions: [{ unitId: 'a', partnerId: 'dead' }],
    })
    expect(action.kind === 'eighth_face_city' && action.choice).not.toBe(null)
  })

  it('spends a Wild Growth on promotions rather than keeping it all as saves', () => {
    const state = board([
      { id: 'a', typeId: 'treefolk.oakling', at: at('frontier') },
      { id: 'dead', typeId: 'treefolk.oak', at: dua },
    ])
    const action = answer(state, {
      kind: 'sai_promote',
      player: 'p1',
      sai: 'Wild Growth',
      budget: 4,
      saveResultsCount: true,
      slot: 'frontier',
      remaining: 1,
    })
    expect(action).toEqual({ kind: 'sai_promote', pairs: [{ unitId: 'a', partnerId: 'dead' }] })
  })

  it('takes a dragon treasure', () => {
    const state = board([
      { id: 'a', typeId: 'treefolk.oak', at: at('frontier') },
      { id: 'dead', typeId: 'treefolk.oak_lord', at: dua },
    ])
    const pair = { unitId: 'a', partnerId: 'dead' }
    expect(
      answer(state, { kind: 'dragon_treasure', player: 'p1', slot: 'frontier', promotions: [pair] }),
    ).toEqual({ kind: 'dragon_treasure', pair })
  })

  it('declines the Temple against a Phoenix in the enemy DUA, and forces it otherwise', () => {
    const pending: Pending = { kind: 'eighth_face_temple', player: 'p1', slot: 'p1_home' }
    const phoenix = board([{ id: 'x', typeId: 'firewalkers.phoenix', owner: 'p2', at: dua }])
    const plain = board([{ id: 'x', typeId: 'firewalkers.guardian', owner: 'p2', at: dua }])
    expect(answer(phoenix, pending)).toEqual({ kind: 'eighth_face_temple', force: false })
    expect(answer(plain, pending)).toEqual({ kind: 'eighth_face_temple', force: true })
  })
})

describe('GreedyAI: reserves', () => {
  it('sends every reserve die out, and toward where it is outnumbered', () => {
    const state = board([
      { id: 'r1', typeId: 'treefolk.oak', at: reserve },
      { id: 'r2', typeId: 'treefolk.oakling', at: reserve },
      { id: 'mine', typeId: 'treefolk.oak', at: at('p1_home') },
      { id: 'e1', typeId: 'firewalkers.salamander', owner: 'p2', at: at('frontier') },
      { id: 'e2', typeId: 'firewalkers.guardian', owner: 'p2', at: at('p2_home') },
    ])
    const action = answer(state, { kind: 'reinforce', player: 'p1' })
    expect(action.kind).toBe('reinforce')
    if (action.kind !== 'reinforce') return
    expect(action.moves.map((m) => m.unitId).sort()).toEqual(['r1', 'r2'])
    expect(action.moves[0]?.slot).toBe('frontier')
  })

  it('pulls surplus dice off a held eighth face when a terrain has none of its dice', () => {
    const state = board(
      [
        { id: 'a', typeId: 'treefolk.oak_lord', at: at('p1_home') },
        { id: 'b', typeId: 'treefolk.oak', at: at('p1_home') },
        { id: 'c', typeId: 'treefolk.oakling', at: at('p1_home') },
        { id: 'd', typeId: 'treefolk.oak', at: at('p2_home') },
      ],
      { p1_home: { face: 8, capturedBy: 'p1' } },
    )
    const action = answer(state, { kind: 'retreat', player: 'p1' })
    expect(action.kind === 'retreat' && action.unitIds.length).toBeGreaterThan(0)
    // The guard stays: half the health, dearest first.
    expect(action.kind === 'retreat' && action.unitIds).not.toContain('a')
  })

  it('leaves to hunt when its only army is one die on its eighth face', () => {
    // One die can never make the second capture, so holding the first is a stalemate:
    // greedy-against-greedy games stalled on one lone die per side until this.
    const state = board(
      [
        { id: 'lone', typeId: 'firewalkers.phoenix', at: at('p2_home') },
        { id: 'e', typeId: 'treefolk.redwood', owner: 'p2', at: at('p1_home') },
      ],
      { p2_home: { face: 8, capturedBy: 'p1' } },
    )
    expect(answer(state, { kind: 'retreat', player: 'p1' })).toEqual({ kind: 'retreat', unitIds: ['lone'] })
  })

  it('retreats nothing when every terrain already holds its dice', () => {
    const state = board(
      [
        { id: 'a', typeId: 'treefolk.oak_lord', at: at('p1_home') },
        { id: 'b', typeId: 'treefolk.oak', at: at('p1_home') },
        { id: 'c', typeId: 'treefolk.oak', at: at('frontier') },
        { id: 'd', typeId: 'treefolk.oak', at: at('p2_home') },
      ],
      { p1_home: { face: 8, capturedBy: 'p1' } },
    )
    expect(answer(state, { kind: 'retreat', player: 'p1' })).toEqual({ kind: 'retreat', unitIds: [] })
  })
})

describe('GreedyAI: the roll-off', () => {
  // Treefolk (water, earth) against Firewalkers (air, fire).
  const state = board([
    { id: 't', typeId: 'treefolk.oak', at: at('p1_home') },
    { id: 'f', typeId: 'firewalkers.watcher', owner: 'p2', at: at('p2_home') },
  ])

  it("picks the Frontier when one proposal is its colours and the other the enemy's", () => {
    const proposals = { p1: 'swampland_city', p2: 'wasteland_city' }
    expect(answer(state, { kind: 'roll_off_choice', player: 'p1', proposals })).toEqual({
      kind: 'roll_off_choice',
      take: 'frontier',
      proposer: 'p1',
    })
  })

  it('takes the first turn when the two proposals are worth the same to it', () => {
    // Highland is fire and earth: one element each, whichever side you are on.
    const proposals = { p1: 'highland_city', p2: 'highland_tower' }
    expect(answer(state, { kind: 'roll_off_choice', player: 'p1', proposals })).toEqual({
      kind: 'roll_off_choice',
      take: 'first_turn',
    })
  })

  it('picks its own colours when the winner leaves it the Frontier', () => {
    const proposals = { p1: 'wasteland_city', p2: 'coastland_city' }
    // Coastland is air and water: one of the Firewalkers' elements and one of ours,
    // against a Wasteland that is both of theirs.
    expect(answer(state, { kind: 'choose_frontier', player: 'p1', proposals })).toEqual({
      kind: 'choose_frontier',
      proposer: 'p2',
    })
  })
})

describe('GreedyAI: self-play', () => {
  /*
   * The phase's fuzz (10c): 200 `V1_RULES` games against `RandomAI` -- what the app
   * plays, roll-off choice included since 10e -- sides
   * alternating, over the starter pair, the bestiary, rolled forces and the monster
   * mirrors. `runGame` validates every state, so an illegal answer -- an announcement
   * the engine refuses above all -- fails here rather than in a browser.
   *
   * **The counters are greedy's own**, read off the log by player. A clean run that
   * never cast a spell or summoned a dragon proves nothing about the spell scorer, and
   * Summon Dragon did go 200 games without firing before it was repriced.
   *
   * The win floor is measured, not guessed: 199 of 200 when this landed. A sign error in
   * a scorer is the bug every other test here would pass, and it shows up as greedy
   * losing to a coin.
   */
  it('plays 200 V1_RULES games against RandomAI: every activity fires, and it wins', () => {
    // By what a mirror is: the built examples joined `FORCE_SETS` in v2 Phase 3e.
    const mirrors = Object.values(FORCE_SETS).filter(isMirror)
    const games: [ForceSpec, number][] = [
      ...Array.from({ length: 60 }, (_, i): [ForceSpec, number] => [STARTER_FORCES, i + 1]),
      ...Array.from({ length: 60 }, (_, i): [ForceSpec, number] => [BESTIARY_FORCES, i + 1]),
      ...Array.from({ length: 60 }, (_, i): [ForceSpec, number] => [{ kind: 'random' }, i + 1]),
      ...Array.from({ length: 20 }, (_, i): [ForceSpec, number] => [mirrors[i % mirrors.length] as ForceSpec, i + 1]),
    ]

    const count: Record<string, number> = {}
    const bump = (key: string): void => {
      count[key] = (count[key] ?? 0) + 1
    }
    let won = 0
    let longest = 0

    for (const [forces, seed] of games) {
      const greedySide: PlayerId = seed % 2 === 0 ? 'p1' : 'p2'
      const result = runGame({
        setup: { seed, forces, ruleSet: V1_RULES },
        players: greedySide === 'p1' ? { p1: greedyAi, p2: randomAi } : { p1: randomAi, p2: greedyAi },
        aiSeed: seed,
        maxDecisions: 20_000,
      })
      expect(result.stoppedBecause, `seed ${seed}`).toBe('winner')
      if (result.state.winner === greedySide) won += 1
      longest = Math.max(longest, result.decisions)

      for (const entry of result.state.log) {
        // The roll-off names its winner, not a player: greedy chose if it won, and
        // picked the Frontier if it lost and the winner took the first turn.
        if (entry.kind === 'roll_off_decided') {
          bump(`${entry.winner === greedySide ? 'won' : 'lost'}_${entry.took}`)
        }
        if (!('player' in entry) || entry.player !== greedySide) continue
        if (entry.kind === 'action_chosen') bump(entry.action)
        else bump(entry.kind)
      }
    }

    expect(won).toBeGreaterThanOrEqual(190)
    for (const activity of [
      'march_begin',
      'maneuver_declared',
      'melee',
      'missile',
      'magic',
      'spell_cast',
      'dragon_summoned',
      'reinforced',
      'units_promoted',
      'units_recruited',
      'dispel_magic',
      // Both answers greedy gives as the winner, and its answer as the loser.
      'won_frontier',
      'won_first_turn',
      'lost_first_turn',
    ]) {
      expect(count[activity] ?? 0, activity).toBeGreaterThan(0)
    }
    // Measured at 354 under SPECIES_RULES and 225 under V1_RULES; the cap is 20,000. A game that runs long is a stall on its way.
    expect(longest).toBeLessThan(2_000)
  })

  it('finishes games against itself, and plays the v0 rules too', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const live = runGame({
        setup: { seed, forces: { kind: 'random' }, ruleSet: SPECIES_RULES },
        players: { p1: greedyAi, p2: greedyAi },
        maxDecisions: 20_000,
      })
      expect(live.stoppedBecause, `live seed ${seed}`).toBe('winner')

      const v0 = runGame({
        setup: { seed, forces: STARTER_FORCES, ruleSet: V0_RULES },
        players: { p1: greedyAi, p2: passiveAi },
        maxDecisions: 20_000,
      })
      expect(v0.stoppedBecause, `v0 seed ${seed}`).not.toBe('stuck')
    }
  })

  /**
   * PLAN-V2's exit check for a species (v2 Phase 5d): its monster mirrors finish against
   * `PassiveAI` and against greedy itself. Against random greedy wins whatever it does;
   * every stall found so far showed up only as a capped game against these two.
   */
  it('finishes every Coral Elves mirror against passive and against itself', () => {
    const coral = Object.entries(FORCE_SETS).filter(([name, spec]) => isMirror(spec) && name.startsWith('coral_elves_'))
    expect(coral.map(([name]) => name).sort()).toEqual([
      'coral_elves_coral_giant',
      'coral_elves_gryphon',
      'coral_elves_leviathan',
      'coral_elves_sprite_swarm',
      'coral_elves_tako',
    ])
    for (const [name, forces] of coral) {
      for (let seed = 1; seed <= 4; seed++) {
        for (const [label, p2] of [['passive', passiveAi], ['greedy', greedyAi]] as const) {
          const result = runGame({
            setup: { seed, forces, ruleSet: V1_RULES },
            players: { p1: greedyAi, p2 },
            aiSeed: seed,
            maxDecisions: 20_000,
            validate: true,
          })
          expect(result.stoppedBecause, `${name} against ${label}, seed ${seed}`).toBe('winner')
        }
      }
    }
  })

  /** The same exit check for the Dwarves (v2 Phase 6f), the slice that made them playable. */
  it('finishes every Dwarves mirror against passive and against itself', () => {
    const dwarves = Object.entries(FORCE_SETS).filter(([name, spec]) => isMirror(spec) && name.startsWith('dwarves_'))
    expect(dwarves.map(([name]) => name).sort()).toEqual([
      'dwarves_androsphinx',
      'dwarves_behemoth',
      'dwarves_gargoyle',
      'dwarves_roc',
      'dwarves_umber_hulk',
    ])
    for (const [name, forces] of dwarves) {
      for (let seed = 1; seed <= 4; seed++) {
        for (const [label, p2] of [['passive', passiveAi], ['greedy', greedyAi]] as const) {
          const result = runGame({
            setup: { seed, forces, ruleSet: V1_RULES },
            players: { p1: greedyAi, p2 },
            aiSeed: seed,
            maxDecisions: 20_000,
            validate: true,
          })
          expect(result.stoppedBecause, `${name} against ${label}, seed ${seed}`).toBe('winner')
        }
      }
    }
  })

  /** The same exit check for the Goblins (v2 Phase 7d), the slice that made them playable. */
  it('finishes every Goblins mirror against passive and against itself', () => {
    const goblins = Object.entries(FORCE_SETS).filter(([name, spec]) => isMirror(spec) && name.startsWith('goblins_'))
    expect(goblins.map(([name]) => name).sort()).toEqual([
      'goblins_cannibal',
      'goblins_death_naga',
      'goblins_harpy',
      'goblins_shambler',
      'goblins_troll',
    ])
    for (const [name, forces] of goblins) {
      for (let seed = 1; seed <= 4; seed++) {
        for (const [label, p2] of [['passive', passiveAi], ['greedy', greedyAi]] as const) {
          const result = runGame({
            setup: { seed, forces, ruleSet: V1_RULES },
            players: { p1: greedyAi, p2 },
            aiSeed: seed,
            maxDecisions: 20_000,
            validate: true,
          })
          expect(result.stoppedBecause, `${name} against ${label}, seed ${seed}`).toBe('winner')
        }
      }
    }
  })

  it('finishes the Coral Elves starter and bestiary against each other species, both ways', () => {
    const pairings: readonly [string, string][] = [
      ['coral_elves_starter', 'treefolk_starter'],
      ['firewalkers_starter', 'coral_elves_starter'],
      ['coral_elves_bestiary', 'firewalkers_bestiary'],
      ['treefolk_bestiary', 'coral_elves_bestiary'],
    ]
    for (const [p1, p2] of pairings) {
      for (let seed = 1; seed <= 3; seed++) {
        for (const [label, other] of [['passive', passiveAi], ['greedy', greedyAi]] as const) {
          const result = runGame({
            setup: { seed, forces: { kind: 'named', forces: { p1, p2 } }, ruleSet: V1_RULES },
            players: { p1: greedyAi, p2: other },
            aiSeed: seed,
            maxDecisions: 20_000,
            validate: true,
          })
          expect(result.stoppedBecause, `${p1} vs ${p2} (${label}), seed ${seed}`).toBe('winner')
        }
      }
    }
  })

  /** The same check for the Dwarves (v2 Phase 6h): starter and bestiary, both ways. */
  it('finishes the Dwarves starter and bestiary against each other species, both ways', () => {
    const pairings: readonly [string, string][] = [
      ['dwarves_starter', 'treefolk_starter'],
      ['firewalkers_starter', 'dwarves_starter'],
      ['dwarves_starter', 'coral_elves_starter'],
      ['dwarves_bestiary', 'firewalkers_bestiary'],
      ['treefolk_bestiary', 'dwarves_bestiary'],
      ['coral_elves_bestiary', 'dwarves_bestiary'],
    ]
    for (const [p1, p2] of pairings) {
      for (let seed = 1; seed <= 3; seed++) {
        for (const [label, other] of [['passive', passiveAi], ['greedy', greedyAi]] as const) {
          const result = runGame({
            setup: { seed, forces: { kind: 'named', forces: { p1, p2 } }, ruleSet: V1_RULES },
            players: { p1: greedyAi, p2: other },
            aiSeed: seed,
            maxDecisions: 20_000,
            validate: true,
          })
          expect(result.stoppedBecause, `${p1} vs ${p2} (${label}), seed ${seed}`).toBe('winner')
        }
      }
    }
  })

  /** The same check for the Goblins (v2 Phase 7f): starter and bestiary, both ways, against
   *  every other species -- the board their death spells and Foul Stench meet everything on. */
  it('finishes the Goblins starter and bestiary against each other species, both ways', () => {
    const pairings: readonly [string, string][] = [
      ['goblins_starter', 'treefolk_starter'],
      ['firewalkers_starter', 'goblins_starter'],
      ['goblins_starter', 'coral_elves_starter'],
      ['dwarves_starter', 'goblins_starter'],
      ['goblins_bestiary', 'firewalkers_bestiary'],
      ['treefolk_bestiary', 'goblins_bestiary'],
      ['goblins_bestiary', 'coral_elves_bestiary'],
      ['dwarves_bestiary', 'goblins_bestiary'],
    ]
    for (const [p1, p2] of pairings) {
      for (let seed = 1; seed <= 3; seed++) {
        for (const [label, other] of [['passive', passiveAi], ['greedy', greedyAi]] as const) {
          const result = runGame({
            setup: { seed, forces: { kind: 'named', forces: { p1, p2 } }, ruleSet: V1_RULES },
            players: { p1: greedyAi, p2: other },
            aiSeed: seed,
            maxDecisions: 20_000,
            validate: true,
          })
          expect(result.stoppedBecause, `${p1} vs ${p2} (${label}), seed ${seed}`).toBe('winner')
        }
      }
    }
  })

  it('never draws from the rng it is handed', () => {
    const state = board([{ id: 'a', typeId: 'treefolk.oak', at: at('frontier') }])
    const rng = rngFrom(5)
    const [, after] = greedyAi.decide(state, { kind: 'choose_march_army', player: 'p1', options: ['frontier'] }, rng)
    expect(after).toBe(rng)
  })
})
