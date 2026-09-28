import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import type { DieRoll } from '../../engine/roll'
import type { LogEntry } from '../../engine/types'

import { advanceCursor, logShows, rollSteps, type CombatEntry, type ManeuverEntry } from './presentation'

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
    expect(rollSteps([magic([plain, smite])], 'p1').map((s) => s.kind)).toEqual(['roll'])
    expect(rollSteps([magic([plain, wildGrowth])], 'p1').map((s) => s.kind)).toEqual(['roll', 'sai'])
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

  it('walks every stop, then moves past the end of the log', () => {
    let cursor = { log: 0, step: 0 }
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      seen.push(cursor.step)
      cursor = advanceCursor(log, cursor, 'p1')
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
