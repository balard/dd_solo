import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import { advance, reduce } from '../../engine/reduce'
import { rollDice, type RngState } from '../../engine/rng'
import type { DieRoll } from '../../engine/roll'
import { rollsOnTheTable } from '../../engine/turn'
import { FULL_RULES, SPELL_RULES, type GameState, type LogEntry, type PlayerId, type TerrainSlot } from '../../engine/types'

import {
  advanceCursor,
  pastEverything,
  rollStops,
  type RollCursor,
  logShows,
  rollSteps as stepsFor,
  type CombatEntry,
  type ManeuverEntry,
  type OwnerOf,
} from './presentation'
import { rollsBehind } from './prompts'

/** A die showing face `faceIndex` of `typeId`, as a roll records it. */
function rolled(typeId: string, faceIndex: number, results: number, effects?: DieRoll['effects']): DieRoll {
  const face = unitType(typeId).faces[faceIndex]
  if (face === undefined) throw new Error(`${typeId} has no face ${faceIndex}`)
  return {
    unitId: `${typeId}#1`,
    typeId,
    faceIndex,
    face,
    results,
    ...(effects === undefined ? {} : { effects }),
  }
}

const plain = rolled('firewalkers.guardian', 1, 2)
// Faces checked against the data: Sentinel's face 4 is Smite, Gorgon's face 1 Flame,
// Noble Willow's face 2 Wild Growth, Oak's face 0 its ID (standing in for a Counter).
const smite = rolled('firewalkers.sentinel', 4, 0, [{ kind: 'unsavable', damage: 4 }])
const flame = rolled('firewalkers.gorgon', 1, 0, [
  { kind: 'target_enemy', health: 2, escape: 'none', fate: 'bury' },
])
const wildGrowth = rolled('treefolk.noble_willow', 2, 0, [{ kind: 'wild_growth', budget: 4 }])
const counter = rolled('treefolk.oak', 0, 0, [{ kind: 'riposte', damage: 2 }])

function combat(overrides: Partial<CombatEntry> = {}): CombatEntry {
  return {
    kind: 'combat_resolved',
    attacker: 'p2',
    defender: 'p1',
    attackerSlot: 'p1_home',
    defenderSlot: 'p1_home',
    action: 'melee',
    isCounter: false,
    attackTotal: 6,
    saveTotal: 2,
    damage: 4,
    attackDice: [plain, smite],
    saveDice: [counter],
    ...overrides,
  }
}

const maneuver: ManeuverEntry = {
  kind: 'maneuver_contested',
  slot: 'frontier',
  marcher: 5,
  defender: 3,
  marcherWins: true,
  marcherDice: [plain],
  defenderDice: [plain],
}

const march: LogEntry = { kind: 'march_begin', player: 'p2', army: 'p2_home', index: 0 }
const flamed: LogEntry = { kind: 'sai_resolved', player: 'p2', sai: 'Flame', slot: 'p1_home', unitIds: ['u1'] }

const magic = (dice: readonly DieRoll[], player: 'p1' | 'p2' = 'p1'): LogEntry => ({
  kind: 'magic_rolled',
  player,
  slot: 'frontier',
  total: 2,
  elements: ['water', 'earth'],
  dice,
})

/** Every die the enemy's, unless a case says whose: what the older cases describe. */
const theirs: OwnerOf = () => 'p2'
const rollSteps = (entries: readonly LogEntry[], human: 'p1' | 'p2', ownerOf: OwnerOf = theirs) =>
  stepsFor(entries, human, ownerOf)

describe('rollSteps', () => {
  /**
   * A resisted roll: the roller's dice, then the resisting roll with what the two came
   * to. Smite and Counter only change the numbers, so they ride on those two cards.
   */
  it('stops on an attack, then the saves, with Smite and Counter on the roll', () => {
    expect(rollSteps([combat()], 'p1').map((s) => s.kind)).toEqual(['attack', 'resist'])
  })

  /**
   * An SAI with something to resolve is a stop of its own, after the attack that rolled
   * it -- and it takes the lines that say what it did, which the log wrote *before* the
   * exchange's own entry.
   */
  it('stops on an SAI that resolves something, carrying what it resolved', () => {
    const steps = rollSteps([flamed, combat({ attackDice: [plain, flame] })], 'p1')
    expect(steps.map((s) => s.kind)).toEqual(['attack', 'sai', 'resist'])
    expect(steps[1]).toEqual({ kind: 'sai', die: flame, resolved: [flamed] })
  })

  it('stops on a maneuver, then the opposing maneuver', () => {
    expect(rollSteps([maneuver], 'p1').map((s) => s.kind)).toEqual(['maneuver', 'counter_maneuver'])
  })

  /** A roll nobody resists: its dice, an SAI only if it resolves something. */
  it('stops once on a magic roll, and again only for a resolving SAI', () => {
    expect(rollSteps([magic([plain, smite], 'p2')], 'p1').map((s) => s.kind)).toEqual(['roll'])
    expect(rollSteps([magic([plain, wildGrowth], 'p2')], 'p1').map((s) => s.kind)).toEqual(['roll', 'sai'])
  })

  /**
   * Reported from a browser: a Reserve Army's Ferry showed the roll, then a card with
   * the Ferry's rule -- the same rule over the same dice as the choice it belonged to.
   * The engine asks before it logs the roll, so the card came *after* the answer and
   * told the player nothing they had not just decided.
   */
  describe('your own SAI', () => {
    const mine: OwnerOf = () => 'p1'
    const ferry = rolled('coral_elves.gryphon', 4, 0, [{ kind: 'free_move', health: 4 }])
    const moved: LogEntry = {
      kind: 'units_moved',
      player: 'p1',
      sai: 'Ferry',
      unitIds: [ferry.unitId],
      from: 'reserve',
      to: 'frontier',
    }
    const attack = combat({ attacker: 'p1', defender: 'p2', attackDice: [plain, flame] })

    it('is not a stop of its own: you answered it already', () => {
      expect(rollSteps([moved, magic([plain, ferry])], 'p1', mine).map((s) => s.kind)).toEqual(['roll'])
      const ownFlame: LogEntry = { ...flamed, player: 'p1' }
      expect(rollSteps([ownFlame, attack], 'p1', mine).map((s) => s.kind)).toEqual(['attack', 'resist'])
    })

    it('leaves what it rolled a stop: the enemy’s dice, rolling for their lives', () => {
      const subRoll: LogEntry = {
        kind: 'sai_sub_roll',
        player: 'p2',
        source: 'Flame',
        slot: 'p2_home',
        test: 'save',
        dice: [plain],
        escaped: [],
      }
      const steps = rollSteps([subRoll, attack], 'p1', mine)
      expect(steps.map((s) => s.kind)).toEqual(['attack', 'roll', 'resist'])
      expect(steps[1]).toEqual({ kind: 'roll', entry: subRoll })
    })

    it('leaves the enemy’s SAIs a stop: you never saw them chosen', () => {
      expect(rollSteps([magic([plain, ferry], 'p2')], 'p1').map((s) => s.kind)).toEqual(['roll', 'sai'])
    })
  })

  it('does not stop for what is not a roll', () => {
    expect(rollSteps([{ kind: 'game_start', seed: 1 }, march, { kind: 'turn_end', player: 'p2' }], 'p1')).toEqual([])
    expect([march, { kind: 'game_start', seed: 1 } as LogEntry].filter(logShows)).toEqual([march])
  })

  /** A sub-roll whose exchange is still paused on a decision is shown where it is. */
  it('shows a sub-roll whose exchange is not logged yet', () => {
    const subRoll: LogEntry = {
      kind: 'sai_sub_roll',
      player: 'p1',
      source: 'Bullseye',
      slot: 'p1_home',
      test: 'save',
      dice: [plain],
      escaped: [],
    }
    expect(rollSteps([subRoll], 'p1').map((s) => s.kind)).toEqual(['roll'])
  })
})

describe('spells', () => {
  const cast = (player: 'p1' | 'p2'): LogEntry => ({
    kind: 'spell_cast',
    player,
    spell: 'stone_skin',
    element: 'earth',
    count: 2,
  })
  const settled = (player: 'p1' | 'p2'): LogEntry => ({
    kind: 'effect_cast',
    player,
    source: 'Stone Skin',
    target: player,
    slot: 'frontier',
  })

  /**
   * What was cast, then what it did and where. The engine logs a spell's consequences
   * *before* its `spell_cast` line, so the card moves each name to the front.
   */
  it('makes the enemy’s spells one stop, each named first and then what it did', () => {
    const steps = rollSteps([settled('p2'), cast('p2'), { kind: 'turn_end', player: 'p2' }], 'p1')
    expect(steps).toEqual([{ kind: 'spells', entries: [cast('p2'), settled('p2')] }])
  })

  it('keeps each spell’s lines with its own name', () => {
    const flood: LogEntry = { kind: 'flash_flood', player: 'p2', slot: 'frontier', needed: 3, resisted: 1, moved: true }
    const floodCast: LogEntry = { kind: 'spell_cast', player: 'p2', spell: 'flash_flood', element: 'water', count: 1 }
    const steps = rollSteps([settled('p2'), cast('p2'), flood, floodCast], 'p1')
    expect(steps).toEqual([{ kind: 'spells', entries: [cast('p2'), settled('p2'), floodCast, flood] }])
  })

  it('does not stop for your own casting, but does for a roll inside it', () => {
    expect(rollSteps([settled('p1'), cast('p1')], 'p1')).toEqual([])
    const saves: LogEntry = { kind: 'spell_saves', player: 'p2', source: 'Hailstorm', slot: 'frontier', saves: 1, dice: [plain] }
    expect(rollSteps([saves, cast('p1')], 'p1').map((s) => s.kind)).toEqual(['roll'])
  })

  /** An effect a spell settles is the spell's, not an SAI waiting for its exchange. */
  it('keeps a spell’s effect in the spell, not held for an SAI', () => {
    const steps = rollSteps([settled('p2'), cast('p2'), combat()], 'p1')
    expect(steps.map((s) => s.kind)).toEqual(['spells', 'attack', 'resist'])
  })
})

describe('advanceCursor', () => {
  const log: readonly LogEntry[] = [march, maneuver, march, combat()]
  // Only the log is read, and no die here resolves an SAI, so nobody's owner is asked.
  const state = { log, units: {}, turn: { combat: null } } as unknown as GameState

  it('walks every stop, then moves past the end of the log', () => {
    let cursor = { log: 0, step: 0 }
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      seen.push(cursor.step)
      cursor = advanceCursor(state, cursor, 'p1')
    }
    // maneuver, opposing maneuver, attack, saves: four stops, then nothing waits.
    expect(seen).toEqual([0, 1, 2, 3])
    expect(cursor).toEqual({ log: log.length, step: 0 })
    expect(rollSteps(log.slice(cursor.log), 'p1')).toEqual([])
  })

  /** New entries after the end are the next stops, from the first. */
  it('picks up rolls written after it', () => {
    const later = [...log, combat({ attackDice: [plain] })]
    const cursor = { log: log.length, step: 0 }
    expect(rollSteps(later.slice(cursor.log), 'p1').map((s) => s.kind)).toEqual(['attack', 'resist'])
  })
})

/**
 * Reported from a browser: a Swallow asked for its target before the attack that rolled
 * it had been shown, and the attack card came after the answer. The engine logs an
 * exchange only once it is over, so a roll parked mid-decision has to be shown from the
 * table, and the log's copy of it skipped when it arrives.
 */
describe('a roll paused on a decision', () => {
  /** Leviathan face 1 is Swallow; Oak face 1 is `2 MELEE`, so a swallowed Oak dies. */
  const LEVIATHAN = 'coral_elves.leviathan'
  const OAK = 'treefolk.oak'

  function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
    const counts = typeIds.map((id) => unitType(id).faces.length)
    for (let counter = 0; counter < 2_000_000; counter += 1) {
      const [indices] = rollDice({ seed: 1, counter }, counts)
      if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
    }
    throw new Error('no counter shows those faces')
  }

  /** p1's Leviathan melees p2's Oak and Oakling at the Frontier. */
  function swallowing(): GameState {
    const terrain = (slot: TerrainSlot) => ({ slot, dieId: 'highland_tower', face: 6 as const, capturedBy: null })
    const at = (id: string, typeId: string, owner: PlayerId) =>
      [id, { id, typeId, owner, location: { kind: 'terrain', slot: 'frontier' } }] as const
    return advance({
      ruleSet: { ...FULL_RULES, dua: 'active' },
      rng: rngShowing([LEVIATHAN, OAK], [1, 1]),
      units: Object.fromEntries([
        at('p1:leviathan', LEVIATHAN, 'p1'),
        at('p2:oak', OAK, 'p2'),
        at('p2:oakling', 'treefolk.oakling', 'p2'),
      ]),
      effects: [],
      dragons: {},
      terrains: { p1_home: terrain('p1_home'), frontier: terrain('frontier'), p2_home: terrain('p2_home') },
      turn: {
        marching: 'p1',
        phase: 'march',
        marchIndex: 0,
        marchStep: 'resolve_attack',
        marchingArmy: 'frontier',
        armiesMarched: ['frontier'],
        combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
      },
      pending: null,
      log: [],
      winner: null,
    } as GameState)
  }

  /** Every stop `useGame` would show from `cursor`, and the cursor past them. */
  function walk(state: GameState, cursor: RollCursor, human: PlayerId) {
    const kinds = rollStops(state, cursor, human).map((stop) => stop.kind)
    let at = cursor
    for (let i = 0; i < kinds.length; i++) at = advanceCursor(state, at, human)
    return { kinds, cursor: at }
  }

  it('shows your attack before you choose, then the enemy’s roll, then the damage', () => {
    const asked = swallowing()
    expect(asked.pending).toMatchObject({ kind: 'sai_target', player: 'p1', sai: 'Swallow' })

    const before = walk(asked, { log: 0, step: 0 }, 'p1')
    expect(before.kinds).toEqual(['live'])
    expect(before.cursor.shown).toEqual(['attack'])

    const done = advance(reduce(asked, { kind: 'sai_target', unitIds: ['p2:oak'] }))
    const after = walk(done, before.cursor, 'p1')
    // No second attack card, and no Swallow card: you just answered it.
    expect(after.kinds).toEqual(['roll', 'resist'])
    expect(rollStops(done, before.cursor, 'p1')[0]).toMatchObject({ entry: { kind: 'sai_sub_roll' } })
    expect(after.cursor.shown).toBeUndefined()
  })

  it('shows the enemy’s attack before it chooses, and what it chose after', () => {
    const asked = swallowing()
    const before = walk(asked, { log: 0, step: 0 }, 'p2')
    expect(before.kinds).toEqual(['live'])

    const done = advance(reduce(asked, { kind: 'sai_target', unitIds: ['p2:oak'] }))
    expect(walk(done, before.cursor, 'p2').kinds).toEqual(['sai', 'resist'])
  })

  it('counts a parked roll skipped past as shown', () => {
    const asked = swallowing()
    expect(pastEverything(asked)).toEqual({ log: asked.log.length, step: 0, shown: ['attack'] })
    expect(rollStops(asked, pastEverything(asked), 'p1')).toEqual([])
  })
})

/**
 * Reported from a browser: a Cantrip window opened before either roll of the exchange
 * had been shown -- your own attack, or the enemy's attack you were saving against --
 * so the spells were picked off dice nobody had seen. The window is a pause inside the
 * exchange, and the rolls that opened it are still parked there.
 */
describe('a Cantrip window', () => {
  /** Genie face 3 is `4 SAI:Cantrip`, face 6 `4 MELEE`; Oak face 1 is `2 MELEE`. */
  const GENIE = 'firewalkers.genie'
  const OAK = 'treefolk.oak'

  function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
    const counts = typeIds.map((id) => unitType(id).faces.length)
    for (let counter = 0; counter < 5_000_000; counter += 1) {
      const [indices] = rollDice({ seed: 1, counter }, counts)
      if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
    }
    throw new Error('no counter shows those faces')
  }

  /** `marching` melees the other side at the Frontier; dice roll attack then saves. */
  function exchange(
    marching: PlayerId,
    units: readonly (readonly [string, string, PlayerId])[],
    rng: RngState,
  ): GameState {
    const terrain = (slot: TerrainSlot) => ({ slot, dieId: 'highland_tower', face: 6 as const, capturedBy: null })
    return advance({
      ruleSet: SPELL_RULES,
      rng,
      units: Object.fromEntries(
        units.map(([id, typeId, owner]) => [id, { id, typeId, owner, location: { kind: 'terrain', slot: 'frontier' } }]),
      ),
      effects: [],
      dragons: {},
      terrains: { p1_home: terrain('p1_home'), frontier: terrain('frontier'), p2_home: terrain('p2_home') },
      turn: {
        marching,
        phase: 'march',
        marchIndex: 0,
        marchStep: 'resolve_attack',
        marchingArmy: 'frontier',
        armiesMarched: ['frontier'],
        combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
      },
      pending: null,
      log: [],
      winner: null,
    } as GameState)
  }

  it('shows your attack before you pick spells with its Cantrips -- one pool of their sum', () => {
    const state = exchange(
      'p1',
      [
        ['p1:genie1', GENIE, 'p1'],
        ['p1:genie2', GENIE, 'p1'],
        ['p1:genie3', GENIE, 'p1'],
        ['p2:oak', OAK, 'p2'],
      ],
      rngShowing([GENIE, GENIE, GENIE], [3, 3, 6]),
    )
    expect(state.pending).toMatchObject({ kind: 'announce_spells', player: 'p1', pool: { points: 8, cantripOnly: true } })
    expect(state.turn.magic?.returnTo).toBe('sai_target_attack')

    expect(rollsOnTheTable(state).map((roll) => [roll.player, roll.kind])).toEqual([['p1', 'attack']])
    expect(rollStops(state, { log: 0, step: 0 }, 'p1').map((stop) => stop.kind)).toEqual(['live'])
    // And the sheet draws the same roll behind the spell picker.
    expect(rollsBehind(state, state.pending)).toMatchObject({ kind: 'live', rolls: [{ kind: 'attack' }] })
  })

  it('shows the enemy’s attack and your saves before you pick spells with a save roll’s Cantrips', () => {
    const state = exchange(
      'p2',
      [
        ['p2:oak', OAK, 'p2'],
        ['p1:genie1', GENIE, 'p1'],
        ['p1:genie2', GENIE, 'p1'],
      ],
      rngShowing([OAK, GENIE, GENIE], [1, 3, 3]),
    )
    expect(state.pending).toMatchObject({ kind: 'announce_spells', player: 'p1', pool: { points: 8 } })
    expect(state.turn.magic?.returnTo).toBe('sai_delayed_attack')

    expect(rollsOnTheTable(state).map((roll) => [roll.player, roll.kind])).toEqual([
      ['p2', 'attack'],
      ['p1', 'save'],
    ])
    expect(rollStops(state, { log: 0, step: 0 }, 'p1').map((stop) => stop.kind)).toEqual(['live', 'live'])
    expect(rollsBehind(state, state.pending)).toMatchObject({
      kind: 'live',
      rolls: [{ kind: 'attack', action: 'melee' }, { kind: 'save' }],
    })
  })
})
