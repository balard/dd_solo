import { describe, expect, it } from 'vitest'

import { SPECIES, TERRAIN_DICE, UNIT_TYPES, homeTerrainType, terrainDie, terrainType, unitType } from '../data/load'
import { PRESETS, maxArmyHealth, preset } from '../data/presets'

import { reduce } from './reduce'
import { rngFrom } from './rng'
import {
  BESTIARY_FORCES,
  dragonCount,
  rollStartingFace,
  namedForces,
  setupGame,
  STARTER_FORCES,
  type SetupOptions,
} from './setup'
import {
  DRAGON_RULES,
  IllegalActionError,
  TERRAIN_SLOTS,
  armyAt,
  capturedCount,
  deadUnits,
  dragonsAt,
  livingUnits,
  opponentOf,
  pooledDragons,
  reserveArmy,
  speciesOf,
  unitsOf,
  type GameState,
  type PlayerId,
} from './types'
import { validateState } from './validate'

const elementsOfSpecies = (id: string): readonly string[] => {
  const species = SPECIES.find((s) => s.id === id)
  if (!species) throw new Error(`unknown species ${id}`)
  return species.elements
}

const OPTIONS: SetupOptions = {
  seed: 1234,
  forces: STARTER_FORCES,
  firstPlayer: 'p1',
}

const healthOf = (units: readonly { typeId: string }[]) =>
  units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)

const presetHealthOf = (p: (typeof PRESETS)[number]) =>
  Object.values(p.armies)
    .flat()
    .reduce((sum, id) => sum + unitType(id).health, 0)

describe('presets', () => {
  it('loads every hand-authored force', () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual([
      'firewalkers_bestiary',
      'firewalkers_fireshadow',
      'firewalkers_genie',
      'firewalkers_gorgon',
      'firewalkers_phoenix',
      'firewalkers_salamander',
      'firewalkers_starter',
      'treefolk_bestiary',
      'treefolk_darktree',
      'treefolk_redwood',
      'treefolk_satyr',
      'treefolk_starter',
      'treefolk_strangle_vine',
      'treefolk_unicorn',
    ])
  })

  /**
   * The monster fixtures, derived rather than listed: a monster added to the data
   * later has to fail here rather than quietly go without a board you can watch it
   * on. Six is not a taste -- the setup cap is half the force, so three at home is
   * the most a 24-health force may start with, and six is the smallest force whose
   * half is three whole monsters.
   */
  it('gives every monster in the data a fixture of its own', () => {
    const monsters = UNIT_TYPES.filter((t) => t.size === 'monster')
    expect(monsters.length).toBe(10)

    for (const monster of monsters) {
      const id = `${monster.species}_${monster.id.split('.')[1]}`
      const fixture = preset(id)
      const all = Object.values(fixture.armies).flat()

      expect(new Set(all), id).toEqual(new Set([monster.id]))
      expect(all.length, id).toBe(6)
      expect(presetHealthOf(fixture), id).toBe(24)
      expect(
        [fixture.armies.home.length, fixture.armies.campaign.length, fixture.armies.horde.length],
        id,
      ).toEqual([3, 2, 1])
    }
  })

  /** All 24 health, so any two of them are a legal game -- mirrors included, which
   *  is the most useful board of the lot for reading one die against itself. */
  it('pairs any two fixtures, including a mirror', () => {
    for (const forces of [
      { p1: 'treefolk_satyr', p2: 'firewalkers_gorgon' },
      { p1: 'treefolk_unicorn', p2: 'treefolk_unicorn' },
    ]) {
      const state = setupGame({ seed: 7, forces: { kind: 'named', forces } })
      validateState(state)
      expect(livingUnits(state, 'p1')).toHaveLength(6)
      expect(livingUnits(state, 'p2')).toHaveLength(6)
    }
  })

  /**
   * The rule is that the two sides of a *game* bring the same total, not that every
   * preset is 30 -- which is what these assertions used to say, back when 30 was the
   * only number any of them was. The bestiary lists are 35.
   */
  it.each([
    ['starter', STARTER_FORCES],
    ['bestiary', BESTIARY_FORCES],
  ])('gives both sides of the %s pairing the same health', (_name, forces) => {
    if (forces.kind !== 'named') throw new Error('a named pairing, or there is nothing to compare')
    const totals = Object.values(forces.forces).map((id) => presetHealthOf(preset(id)))
    expect(new Set(totals).size, `totals ${totals.join(' vs ')}`).toBe(1)
  })

  it('keeps every starting army non-empty and within half the force', () => {
    for (const p of PRESETS) {
      const cap = maxArmyHealth(presetHealthOf(p))
      for (const [name, ids] of Object.entries(p.armies)) {
        const health = ids.reduce((sum, id) => sum + unitType(id).health, 0)
        expect(health, `${p.id} ${name}`).toBeLessThanOrEqual(cap)
        expect(ids.length, `${p.id} ${name}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The reason this preset exists. The starter lists field one monster each and so
   * reach 10 of the 25 SAIs; the fifteen they miss live almost entirely on the
   * monster dice, which is what makes "one of every monster" the useful shape.
   */
  it('puts every SAI in the game on the board, which the starter lists do not', () => {
    const saisOf = (forces: typeof BESTIARY_FORCES) => {
      if (forces.kind !== 'named') throw new Error('a named pairing')
      const names = new Set<string>()
      for (const id of Object.values(forces.forces)) {
        for (const unitId of Object.values(preset(id).armies).flat()) {
          for (const face of unitType(unitId).faces) {
            if (face.icon === 'SAI') names.add(face.sai)
          }
        }
      }
      return names
    }

    expect(saisOf(BESTIARY_FORCES).size).toBe(25)
    expect(saisOf(STARTER_FORCES).size).toBe(10)
  })
})

describe('rollStartingFace', () => {
  it('only ever produces 1-6', () => {
    let rng = rngFrom(99)
    for (let i = 0; i < 3000; i++) {
      const [face, next] = rollStartingFace(rng)
      expect(face).toBeGreaterThanOrEqual(1)
      expect(face).toBeLessThanOrEqual(6)
      rng = next
    }
  })

  it('reaches 6 more often than any other face, because 7 folds down onto it', () => {
    let rng = rngFrom(4242)
    const counts = new Map<number, number>()
    for (let i = 0; i < 12_000; i++) {
      const [face, next] = rollStartingFace(rng)
      counts.set(face, (counts.get(face) ?? 0) + 1)
      rng = next
    }
    const sixes = counts.get(6) ?? 0
    for (const face of [1, 2, 3, 4, 5]) {
      expect(sixes, `6 vs ${face}`).toBeGreaterThan(counts.get(face) ?? 0)
    }
  })
})

describe('setupGame', () => {
  const state = setupGame(OPTIONS)

  it('produces a valid state', () => {
    expect(validateState(state)).toEqual([])
  })

  it('places 60 health of units, 30 a side', () => {
    expect(Object.keys(state.units)).toHaveLength(28) // 14 dice a side
    for (const player of ['p1', 'p2'] as PlayerId[]) {
      expect(healthOf(unitsOf(state, player)), player).toBe(30)
    }
  })

  it('starts every unit on a terrain, none in reserve or dead', () => {
    for (const player of ['p1', 'p2'] as PlayerId[]) {
      expect(reserveArmy(state, player)).toEqual([])
      expect(deadUnits(state, player)).toEqual([])
      expect(livingUnits(state, player)).toHaveLength(unitsOf(state, player).length)
    }
  })

  it('deploys Home at your terrain, Campaign at the Frontier, Horde at the enemy terrain', () => {
    const p1 = preset('treefolk_starter')
    expect(healthOf(armyAt(state, 'p1', 'p1_home'))).toBe(
      p1.armies.home.reduce((s, id) => s + unitType(id).health, 0),
    )
    expect(healthOf(armyAt(state, 'p1', 'frontier'))).toBe(
      p1.armies.campaign.reduce((s, id) => s + unitType(id).health, 0),
    )
    expect(healthOf(armyAt(state, 'p1', 'p2_home'))).toBe(
      p1.armies.horde.reduce((s, id) => s + unitType(id).health, 0),
    )
  })

  it('puts both sides at every terrain, since Horde meets Home', () => {
    for (const slot of TERRAIN_SLOTS) {
      expect(armyAt(state, 'p1', slot).length, slot).toBeGreaterThan(0)
      expect(armyAt(state, 'p2', slot).length, slot).toBeGreaterThan(0)
    }
  })

  it('lets a caller pin a terrain die, which is how the goldens keep their board', () => {
    const pinned = setupGame({ ...OPTIONS, terrains: { frontier: 'highland_tower' } })
    expect(pinned.terrains.frontier.dieId).toBe('highland_tower')
    // Pinning the Frontier does not touch the p1_home *die* draw before it in the
    // stream. Its face still moves, because every face is rolled from one shared
    // counter after all three dice are drawn, and skipping the Frontier's two
    // draws shifts everything after it -- see "the Phase 5b terrain draw" below.
    expect(pinned.terrains.p1_home.dieId).toEqual(state.terrains.p1_home.dieId)
  })

  it('starts every terrain on a face between 1 and 6, uncaptured', () => {
    for (const slot of TERRAIN_SLOTS) {
      const terrain = state.terrains[slot]
      expect(terrain.face, slot).toBeGreaterThanOrEqual(1)
      expect(terrain.face, slot).toBeLessThanOrEqual(6)
      expect(terrain.capturedBy, slot).toBeNull()
    }
    expect(capturedCount(state, 'p1')).toBe(0)
    expect(capturedCount(state, 'p2')).toBe(0)
  })

  it('gives the first march to the chosen player', () => {
    expect(state.turn.marching).toBe('p1')
    expect(setupGame({ ...OPTIONS, firstPlayer: 'p2' }).turn.marching).toBe('p2')
    expect(state.turn.armiesMarched).toEqual([])
    expect(state.winner).toBeNull()
  })

  // The determinism guarantee everything downstream rests on: save/load, undo,
  // reproducible bug reports, and the Phase 6 fuzz harness.
  it('is reproducible from its seed', () => {
    expect(setupGame(OPTIONS)).toEqual(setupGame(OPTIONS))
  })

  it('gives different seeds different opening terrain faces', () => {
    const faces = (seed: number) =>
      TERRAIN_SLOTS.map((slot) => setupGame({ ...OPTIONS, seed }).terrains[slot].face).join(',')
    const distinct = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(faces))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('records the opening in the log', () => {
    expect(state.log[0]).toEqual({ kind: 'game_start', seed: 1234, firstPlayer: 'p1' })
    expect(state.log.filter((e) => e.kind === 'terrain_placed')).toHaveLength(3)
  })

  it('rejects an unknown preset', () => {
    expect(() =>
      setupGame({ ...OPTIONS, forces: { kind: 'named', forces: { p1: 'nope', p2: 'nope' } } }),
    ).toThrow()
  })
})

describe('the terrain draw', () => {
  const ALL_PINNED = {
    p1_home: 'swampland_tower',
    frontier: 'highland_tower',
    p2_home: 'wasteland_tower',
  } as const

  it("draws each Home Terrain from the species' own type, all four eighth faces, over 1000 seeds", () => {
    // Starter forces: p1 is Treefolk (water, earth), p2 Firewalkers (air, fire).
    const p1Home = new Set<string>()
    const p2Home = new Set<string>()
    for (let seed = 1; seed <= 1000; seed++) {
      const state = setupGame({ seed, forces: STARTER_FORCES, firstPlayer: 'p1' })
      p1Home.add(state.terrains.p1_home.dieId)
      p2Home.add(state.terrains.p2_home.dieId)
    }
    const ofType = (type: string) => TERRAIN_DICE.filter((d) => d.type === type).map((d) => d.id).sort()
    expect([...p1Home].sort()).toEqual(ofType('swampland'))
    expect([...p2Home].sort()).toEqual(ofType('wasteland'))
  })

  it("finds each species' own type from the data: the one whose elements are exactly its own", () => {
    expect(homeTerrainType('treefolk').id).toBe('swampland')
    expect(homeTerrainType('firewalkers').id).toBe('wasteland')
  })

  it('always draws a Frontier sharing an element with the roll-off loser, over 1000 random-force seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const state = setupGame({ seed, forces: { kind: 'random' } })
      expect(validateState(state), `seed ${seed}`).toEqual([])

      const loserElements = elementsOfSpecies(speciesOf(state, opponentOf(state.turn.marching)))
      const frontierElements = terrainType(terrainDie(state.terrains.frontier.dieId).type).elements
      expect(frontierElements.some((e) => loserElements.includes(e)), `seed ${seed}`).toBe(true)
    }
  })

  it('draws the Frontier from every die sharing an element with the loser, and no other', () => {
    // p2 (Firewalkers, air and fire) always loses here, since p1 always marches first:
    // every die but the four Swamplands (water and earth) is eligible.
    const seen = new Map<string, number>()
    for (let seed = 1; seed <= 2000; seed++) {
      const state = setupGame({ seed, forces: STARTER_FORCES, firstPlayer: 'p1' })
      const dieId = state.terrains.frontier.dieId
      seen.set(dieId, (seen.get(dieId) ?? 0) + 1)
    }
    const eligible = TERRAIN_DICE.filter((d) => d.type !== 'swampland').map((d) => d.id).sort()
    expect([...seen.keys()].sort()).toEqual(eligible)
    // Uniform, not element-first: the own type is no longer drawn twice as often. 2000
    // draws over 20 dice is 100 each; no die strays anywhere near double.
    for (const [dieId, n] of seen) expect(n, dieId).toBeLessThan(160)
  })

  it('lets the other player species decide the Frontier when firstPlayer is given explicitly', () => {
    const p1LosesToP2 = setupGame({ ...OPTIONS, firstPlayer: 'p2' })
    const p2LosesToP1 = setupGame({ ...OPTIONS, firstPlayer: 'p1' })
    expect(
      terrainType(terrainDie(p1LosesToP2.terrains.frontier.dieId).type).elements.some((e) =>
        elementsOfSpecies('treefolk').includes(e),
      ),
    ).toBe(true)
    expect(
      terrainType(terrainDie(p2LosesToP1.terrains.frontier.dieId).type).elements.some((e) =>
        elementsOfSpecies('firewalkers').includes(e),
      ),
    ).toBe(true)
  })

  it('consumes no terrain draw at all when every slot is pinned', () => {
    const pinned = setupGame({ ...OPTIONS, terrains: ALL_PINNED })
    // Recorded once, empirically: with all three terrains pinned the only draws
    // left are the three opening face rolls. A pinned slot has never consumed a
    // draw, before or after Phase 5b -- this is the fast version of what the 25
    // goldens prove at full length.
    expect(pinned.rng.counter).toBe(3)
  })

  it('draws only for the slot left unpinned', () => {
    const full = setupGame({ ...OPTIONS, terrains: ALL_PINNED })
    const partial = setupGame({
      ...OPTIONS,
      terrains: { p1_home: ALL_PINNED.p1_home, p2_home: ALL_PINNED.p2_home },
    })
    expect(partial.terrains.p1_home.dieId).toBe(full.terrains.p1_home.dieId)
    expect(partial.terrains.p2_home.dieId).toBe(full.terrains.p2_home.dieId)
    // Exactly the Frontier's one draw more than the fully pinned board -- the faces
    // differ too, since all three are rolled off one shared counter after the dice,
    // and that extra draw shifts it. (Two draws before the uniform Frontier draw: an
    // element, then a die.)
    expect(partial.rng.counter).toBe(full.rng.counter + 1)
  })

  it('sets up and validates a game whose two homes draw the same die', () => {
    // Only a mirror can: two species never share a home type any more.
    const mirror = namedForces('treefolk_satyr')
    if (mirror === null) throw new Error('no Satyr mirror')
    const state = Array.from({ length: 40 }, (_, i) =>
      setupGame({ seed: i + 1, forces: mirror, firstPlayer: 'p1' }),
    ).find((s) => s.terrains.p1_home.dieId === s.terrains.p2_home.dieId)
    expect(state).toBeDefined()
    expect(validateState(state as GameState)).toEqual([])
  })

  it('draws Standing Stones like any other icon, in every slot', () => {
    const seenIn = { p1_home: false, frontier: false, p2_home: false }
    for (let seed = 1; seed <= 1000; seed++) {
      const state = setupGame({ seed, forces: { kind: 'random' } })
      for (const slot of TERRAIN_SLOTS) {
        if (terrainDie(state.terrains[slot].dieId).eighthFace === 'standing_stones') {
          seenIn[slot] = true
        }
      }
    }
    expect(seenIn).toEqual({ p1_home: true, frontier: true, p2_home: true })
  })
})

describe('the Phase 6 dragon draw', () => {
  const withDragons = (seed: number, forces = STARTER_FORCES) =>
    setupGame({ seed, forces, ruleSet: DRAGON_RULES })

  it('brings one dragon per 24 points of force, or part thereof', () => {
    expect(dragonCount(24)).toBe(1)
    expect(dragonCount(30)).toBe(2)
    expect(dragonCount(35)).toBe(2)
    expect(dragonCount(36)).toBe(2)
    expect(dragonCount(48)).toBe(2)
    expect(dragonCount(49)).toBe(3)
  })

  it('gives each 30-health starter force two dragons', () => {
    const state = withDragons(7)
    for (const player of ['p1', 'p2'] as const) {
      const mine = Object.values(state.dragons).filter((d) => d.owner === player)
      expect(mine, player).toHaveLength(2)
    }
  })

  it('draws colours from the force own species elements, so Death never appears', () => {
    // Treefolk are water+earth and Firewalkers air+fire, which covers four of the
    // five. The fifth is in the data and no game of these two can reach it.
    for (let seed = 1; seed <= 200; seed++) {
      for (const dragon of Object.values(withDragons(seed).dragons)) {
        const element = dragon.dieId.split('_')[0]
        const expected = dragon.owner === 'p1' ? ['earth', 'water'] : ['air', 'fire']
        expect(expected, `seed ${seed} ${dragon.id}`).toContain(element)
      }
    }
  })

  it('gives a two-dragon force exactly one of each of its elements', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const state = withDragons(seed)
      for (const player of ['p1', 'p2'] as const) {
        const elements = Object.values(state.dragons)
          .filter((d) => d.owner === player)
          .map((d) => d.dieId.split('_')[0])
          .sort()
        expect(elements, `seed ${seed} ${player}`).toEqual(
          player === 'p1' ? ['earth', 'water'] : ['air', 'fire'],
        )
      }
    }
  })

  it('draws both forms across enough seeds -- the form is not fixed by the element', () => {
    const forms = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) {
      for (const dragon of Object.values(withDragons(seed).dragons)) {
        forms.add(dragon.dieId.split('_')[1] as string)
      }
    }
    expect([...forms].sort()).toEqual(['drake', 'wyrm'])
  })

  it('seeds exactly one dragon per player at the Frontier and pools the rest', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const state = withDragons(seed)
      const atFrontier = dragonsAt(state, 'frontier')
      expect(atFrontier, `seed ${seed}`).toHaveLength(2)
      expect(atFrontier.map((d) => d.owner).sort()).toEqual(['p1', 'p2'])
      for (const player of ['p1', 'p2'] as const) {
        expect(pooledDragons(state, player), `seed ${seed} ${player}`).toHaveLength(1)
      }
      // No dragon starts at either home terrain.
      expect(dragonsAt(state, 'p1_home')).toEqual([])
      expect(dragonsAt(state, 'p2_home')).toEqual([])
    }
  })

  it('empties the pool of a one-dragon force, and draws nothing to pick from it', () => {
    // Every monster fixture is 24 health, so each side brings exactly one dragon.
    const forces = { kind: 'named', forces: { p1: 'treefolk_darktree', p2: 'treefolk_darktree' } } as const
    const state = setupGame({ seed: 5, forces, ruleSet: DRAGON_RULES })
    expect(dragonsAt(state, 'frontier')).toHaveLength(2)
    for (const player of ['p1', 'p2'] as const) {
      expect(pooledDragons(state, player), player).toEqual([])
    }
  })

  it('draws no dragons at all, and no randomness, when the rules have none', () => {
    const without = setupGame({ seed: 7, forces: STARTER_FORCES })
    expect(without.dragons).toEqual({})
    // The load-bearing half: the dragon draws sit last and behind the flag, so a
    // game without them consumes exactly the randomness it always did. This is what
    // keeps all 25 goldens replaying byte-identical.
    expect(without.rng).toEqual(setupGame({ seed: 7, forces: STARTER_FORCES }).rng)
    expect(withDragons(7).rng.counter).toBeGreaterThan(without.rng.counter)
    expect(without.terrains).toEqual(withDragons(7).terrains)
  })

  it('logs what each player brought and which one took the Frontier', () => {
    const state = withDragons(7)
    const entries = state.log.filter((e) => e.kind === 'dragons_drawn')
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      if (entry.kind !== 'dragons_drawn') throw new Error('narrowing')
      expect(entry.pool).toContain(entry.frontier)
      expect(entry.pool).toHaveLength(2)
    }
  })

  it('leaves a dragon state validateState is happy with', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(validateState(withDragons(seed)), `seed ${seed}`).toEqual([])
    }
  })

  it('refuses a dragon in play under dragons: false', () => {
    const state = withDragons(7)
    const smuggled: GameState = { ...state, ruleSet: { ...state.ruleSet, dragons: false } }
    expect(validateState(smuggled)).toContain('dragons: 4 in play under dragons: false')
  })
})

describe('order of play', () => {
  const rolled = (seed: number) =>
    setupGame({ seed, forces: STARTER_FORCES })

  it('decides the first player by the Horde roll-off when none is given', () => {
    const state = rolled(7)
    const entry = state.log.find((e) => e.kind === 'order_of_play')
    expect(entry).toBeDefined()
    if (entry?.kind !== 'order_of_play') throw new Error('unreachable')
    expect(entry.firstPlayer).toBe(state.turn.marching)
    expect(entry.rolls.p1).not.toBe(entry.rolls.p2)
    expect(entry.firstPlayer).toBe(entry.rolls.p1 > entry.rolls.p2 ? 'p1' : 'p2')
  })

  it('still produces a valid state', () => {
    expect(validateState(rolled(7))).toEqual([])
  })

  it('lets either side win across seeds', () => {
    const winners = new Set(
      Array.from({ length: 40 }, (_, i) => rolled(i + 1).turn.marching),
    )
    expect(winners).toEqual(new Set(['p1', 'p2']))
  })

  it('skips the roll-off entirely when a first player is given', () => {
    const state = setupGame(OPTIONS)
    expect(state.log.some((e) => e.kind === 'order_of_play')).toBe(false)
  })

  it('stays reproducible with the roll-off in the stream', () => {
    expect(rolled(21)).toEqual(rolled(21))
  })
})

describe('validateState', () => {
  const state = setupGame(OPTIONS)

  it('accepts a freshly set up game', () => {
    expect(validateState(state)).toEqual([])
  })

  it('catches a terrain captured without being on face 8', () => {
    const broken: GameState = {
      ...state,
      terrains: { ...state.terrains, frontier: { ...state.terrains.frontier, capturedBy: 'p1' } },
    }
    expect(validateState(broken).join()).toMatch(/captured by p1 but on face/)
  })

  it('catches face 8 with nobody holding it', () => {
    const broken: GameState = {
      ...state,
      terrains: { ...state.terrains, frontier: { ...state.terrains.frontier, face: 8 } },
    }
    expect(validateState(broken).join()).toMatch(/on face 8 but nobody has captured it/)
  })

  it('catches two captures without a winner', () => {
    const broken: GameState = {
      ...state,
      terrains: {
        ...state.terrains,
        frontier: { ...state.terrains.frontier, face: 8, capturedBy: 'p1' },
        p2_home: { ...state.terrains.p2_home, face: 8, capturedBy: 'p1' },
      },
    }
    expect(validateState(broken).join()).toMatch(/holds 2 terrains but is not recorded as the winner/)
  })

  it('catches an unknown unit type', () => {
    const first = Object.values(state.units)[0]!
    const broken: GameState = {
      ...state,
      units: { ...state.units, [first.id]: { ...first, typeId: 'treefolk.ent' } },
    }
    expect(validateState(broken).join()).toMatch(/unknown unit type treefolk\.ent/)
  })

  it('catches the same army marching twice', () => {
    const broken: GameState = {
      ...state,
      turn: { ...state.turn, armiesMarched: ['frontier', 'frontier'] },
    }
    expect(validateState(broken).join()).toMatch(/each march needs a different army/)
  })
})

describe('reduce', () => {
  const state = setupGame(OPTIONS)

  it('rejects an action when nothing is pending', () => {
    expect(() => reduce(state, { kind: 'choose_maneuver', maneuver: true })).toThrow(
      IllegalActionError,
    )
  })

  it('rejects an action that answers a different decision', () => {
    const waiting: GameState = {
      ...state,
      pending: { kind: 'choose_maneuver', player: 'p1', slot: 'frontier' },
    }
    expect(() => reduce(waiting, { kind: 'contest_maneuver', contest: true })).toThrow(
      /waiting for choose_maneuver/,
    )
  })

  it('rejects any action once the game is over', () => {
    const finished: GameState = { ...state, winner: 'p1', turn: { ...state.turn, phase: 'game_over' } }
    expect(() => reduce(finished, { kind: 'choose_maneuver', maneuver: true })).toThrow(
      /the game is over/,
    )
  })

  it('does not mutate the state it is given', () => {
    const before = JSON.stringify(state)
    try {
      reduce(state, { kind: 'choose_maneuver', maneuver: true })
    } catch {
      /* expected */
    }
    expect(JSON.stringify(state)).toBe(before)
  })
})
