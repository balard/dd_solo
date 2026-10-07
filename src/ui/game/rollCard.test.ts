import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import type { DieRoll } from '../../engine/roll'
import type { GameState, LogEntry } from '../../engine/types'

import { combatExchange } from './exchange'
import type { CombatEntry, ManeuverEntry, RollStep } from './presentation'
import { atPlace, headingOf, saiLines } from './RollCard'

/**
 * v2 Phase 9b: a card names whose roll it is and where, with the number it came to
 * beside it. The review found "The maneuver roll" and "The opposing maneuver roll",
 * which named neither player nor terrain, and live cards whose total was a bare "4".
 */
const die = (unitId: string, typeId = 'firewalkers.guardian', faceIndex = 1, results = 2): DieRoll => {
  const face = unitType(typeId).faces[faceIndex]
  if (face === undefined) throw new Error('no face')
  return { unitId, typeId, faceIndex, face, results }
}

// Whose dice are whose: the units the headings ask about.
const state = {
  units: {
    mine: { id: 'mine', typeId: 'treefolk.oak', owner: 'p1', location: { kind: 'terrain', slot: 'frontier' } },
    theirs: { id: 'theirs', typeId: 'firewalkers.gorgon', owner: 'p2', location: { kind: 'terrain', slot: 'frontier' } },
  },
  turn: { marching: 'p2' },
} as unknown as GameState

const melee: CombatEntry = {
  kind: 'combat_resolved',
  attacker: 'p2',
  defender: 'p1',
  attackerSlot: 'p1_home',
  defenderSlot: 'p1_home',
  action: 'melee',
  isCounter: false,
  attackTotal: 9,
  saveTotal: 5,
  damage: 4,
  attackDice: [die('theirs')],
  saveDice: [die('mine')],
}

const contest: ManeuverEntry = {
  kind: 'maneuver_contested',
  slot: 'frontier',
  marcher: 7,
  defender: 5,
  marcherWins: true,
  marcherDice: [die('theirs')],
  defenderDice: [die('mine')],
}

const heading = (step: RollStep) => headingOf(step, state, 'p1')

describe('a roll card’s heading', () => {
  it('says whose attack, what and where, with its total', () => {
    expect(heading({ kind: 'attack', entry: melee })).toEqual({
      title: 'The enemy rolls melee at Your home',
      total: { n: 9, of: 'melee' },
    })
    expect(heading({ kind: 'attack', entry: { ...melee, attacker: 'p1', defender: 'p2', isCounter: true } })).toMatchObject({
      title: 'You roll a counter-attack at Your home',
    })
  })

  it('names both ends of a missile that crosses the board', () => {
    const missile = { ...melee, action: 'missile' as const, attackerSlot: 'p2_home' as const, defenderSlot: 'frontier' as const }
    expect(heading({ kind: 'attack', entry: missile }).title).toBe('The enemy rolls missile from the Enemy home at the Frontier')
  })

  it('says whose saves, and what a save roll shown live came to', () => {
    expect(heading({ kind: 'resist', entry: melee })).toEqual({
      title: 'You save at Your home',
      total: { n: 5, of: 'saves' },
    })
    expect(heading({ kind: 'resist', entry: melee, outcomeOnly: true })).toEqual({
      title: 'What it came to at Your home',
      total: { n: 4, of: 'damage' },
    })
  })

  it('names the marcher and the side that contests, read off their dice', () => {
    expect(heading({ kind: 'maneuver', entry: contest })).toEqual({
      title: 'The enemy rolls to turn the Frontier',
      total: { n: 7, of: 'maneuver' },
    })
    expect(heading({ kind: 'counter_maneuver', entry: contest })).toEqual({
      title: 'You roll to stop it at the Frontier',
      total: { n: 5, of: 'maneuver' },
    })
  })

  it('gives a live roll its total and its place, from the exchange it is parked in', () => {
    const live: RollStep = {
      kind: 'live',
      roll: { player: 'p2', kind: 'attack', action: 'melee', roll: { dice: [die('theirs')], total: 4 } },
      exchange: combatExchange(melee, 'roll'),
    }
    expect(heading(live)).toEqual({ title: 'The enemy rolls melee at Your home', total: { n: 4, of: 'melee' } })
  })

  it('names an SAI by whose it is and where it struck', () => {
    const flame = die('theirs', 'firewalkers.gorgon', 1, 0)
    expect(heading({ kind: 'sai', die: flame, resolved: [], exchange: combatExchange(melee, 'sais', flame) }).title).toBe(
      'The enemy’s Flame at Your home',
    )
  })

  it('names the enemy’s losses', () => {
    const killed: LogEntry = { kind: 'units_killed', player: 'p2', slot: 'p2_home', unitIds: ['theirs'] }
    expect(heading({ kind: 'losses', entry: killed as Extract<LogEntry, { kind: 'units_killed' }> }).title).toBe(
      'The enemy’s losses at the Enemy home',
    )
  })
})

describe('atPlace', () => {
  it('reads as a phrase', () => {
    expect(['p1_home', 'frontier', 'p2_home', 'reserve'].map((slot) => atPlace(slot as 'frontier', 'p1'))).toEqual([
      'at Your home',
      'at the Frontier',
      'at the Enemy home',
      'in Reserves',
    ])
  })
})

/**
 * v2 Phase 9d: an SAI die on a card was only a border, and what it did lived in the
 * tooltip. Now each gets a line in the strip's own words, with where it stands.
 */
describe('a card’s SAI lines', () => {
  const flame: DieRoll = {
    ...die('theirs', 'firewalkers.gorgon', 1, 0),
    effects: [{ kind: 'target_enemy', health: 2, escape: 'none', fate: 'bury' }] as NonNullable<DieRoll['effects']>,
  }
  const attack = { ...melee, attackDice: [die('theirs'), flame] }

  it('says what the SAI does, and that it resolves next', () => {
    expect(saiLines({ kind: 'attack', entry: attack, exchange: combatExchange(attack, 'roll') })).toEqual([
      { sai: 'Flame', count: 2, unit: 'Gorgon', does: '2 health-worth killed and buried', when: 'next' },
    ])
  })

  it('draws no line for a die with no SAI, or one whose SAI did nothing here', () => {
    const idle = die('theirs', 'firewalkers.gorgon', 1, 0)
    expect(saiLines({ kind: 'attack', entry: { ...melee, attackDice: [die('theirs'), idle] } })).toEqual([])
  })

  it('leaves the saves card’s lines to the save dice', () => {
    expect(saiLines({ kind: 'resist', entry: attack, exchange: combatExchange(attack, 'resist') })).toEqual([])
  })
})
