import { describe, expect, it } from 'vitest'
import { doublesIds, legalActions, magicDamage, missileTargets, terrainAction } from './combat'
import { damageOptions } from './damage'
import { begin, reduce } from './reduce'
import { rollArmy } from './roll'
import { setupGame, STARTER_FORCES } from './setup'
import {
  IllegalActionError,
  armyAt,
  livingUnits,
  type GameAction,
  type GameState,
  type LogEntry,
  type PlayerId,
  type TerrainFace,
  type TerrainSlot,
  V0_RULES,
} from './types'
import { validateState } from './validate'
/**
 * Every test below reads an action off a terrain face, so which terrain sits at the
 * Frontier decides what they mean: Highland runs magic on faces 1-3 and melee on
 * 6-7, Wasteland magic on 1 alone. Phase 0a made the Frontier depend on who lost
 * the roll-off, so it is pinned here rather than left to the setup.
 */
const fresh = (seed = 1234, firstPlayer: PlayerId = 'p1') =>
  setupGame({
    seed,
    forces: STARTER_FORCES,
    firstPlayer,
    terrains: { frontier: 'highland_tower' },
  })
function play(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce((current, action) => {
    const next = reduce(current, action)
    const problems = validateState(next)
    if (problems.length > 0) {
      throw new Error(`invalid after ${action.kind}:\n  ${problems.join('\n  ')}`)
    }
    return next
  }, state)
}
function setFace(state: GameState, slot: TerrainSlot, face: TerrainFace): GameState {
  return {
    ...state,
    terrains: { ...state.terrains, [slot]: { ...state.terrains[slot], face, capturedBy: null } },
  }
}
function emptyArmy(state: GameState, player: PlayerId, slot: TerrainSlot): GameState {
  const units = { ...state.units }
  for (const unit of armyAt(state, player, slot)) {
    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
  }
  return { ...state, units }
}
/** The engine's own suggested maximal assignment for the current pending damage. */
function damageSuggestion(state: GameState): { suggestion: readonly string[] } {
  const pending = state.pending
  if (pending?.kind !== 'assign_damage') throw new Error('not awaiting damage')
  return damageOptions(armyAt(state, pending.player, pending.slot), pending.damage)
}
const combatEntries = (state: GameState) =>
  state.log.filter((e): e is Extract<LogEntry, { kind: 'combat_resolved' }> =>
    e.kind === 'combat_resolved',
  )
/**
 * Terrain face layouts, so a test can put a terrain on the face it needs:
 *   Frontier  = highland  -- 1,2,3 magic  4,5 missile   6,7 melee
 *   p1_home   = swampland -- 1,2 magic    3,4 missile   5,6,7 melee
 *   p2_home   = wasteland -- 1 magic      2,3 missile   4,5,6,7 melee
 */
const MELEE_AT_FRONTIER = 6
const MISSILE_AT_FRONTIER = 4
const MAGIC_AT_FRONTIER = 2
/** Marches the Frontier army, declines the maneuver, and takes `action`. */
const attackFromFrontier = (state: GameState, action: 'melee' | 'missile' | 'magic') =>
  play(
    begin(state),
    { kind: 'choose_march_army', army: 'frontier' },
    { kind: 'choose_maneuver', maneuver: false },
    { kind: 'choose_action', action },
  )
describe('terrainAction', () => {
  it('reads the action off the current face', () => {
    const state = fresh()
    expect(terrainAction(setFace(state, 'frontier', 1), 'frontier')).toBe('magic')
    expect(terrainAction(setFace(state, 'frontier', 4), 'frontier')).toBe('missile')
    expect(terrainAction(setFace(state, 'frontier', 7), 'frontier')).toBe('melee')
    expect(terrainAction(setFace(state, 'p2_home', 1), 'p2_home')).toBe('magic')
    expect(terrainAction(setFace(state, 'p2_home', 4), 'p2_home')).toBe('melee')
  })
})
describe('legalActions', () => {
  it('offers the action the terrain permits', () => {
    const state = setFace(fresh(), 'frontier', MELEE_AT_FRONTIER)
    expect(legalActions(state, 'p1', 'frontier')).toEqual(['melee'])
  })
  it('offers nothing when melee has nothing to hit', () => {
    const state = emptyArmy(setFace(fresh(), 'frontier', MELEE_AT_FRONTIER), 'p2', 'frontier')
    expect(legalActions(state, 'p1', 'frontier')).toEqual([])
  })
  it('offers nothing when magic has nothing to hit, since v0 magic is melee-like', () => {
    const state = emptyArmy(setFace(fresh(), 'frontier', MAGIC_AT_FRONTIER), 'p2', 'frontier')
    expect(legalActions(state, 'p1', 'frontier')).toEqual([])
  })
  it('offers missile while any target is reachable', () => {
    const state = setFace(fresh(), 'frontier', MISSILE_AT_FRONTIER)
    expect(legalActions(state, 'p1', 'frontier')).toEqual(['missile'])
  })
})
describe('missileTargets', () => {
  it('reaches every terrain holding an enemy army, from the Frontier', () => {
    const state = fresh()
    expect([...missileTargets(state, 'p1', 'frontier')].sort()).toEqual([
      'frontier',
      'p1_home',
      'p2_home',
    ])
  })
  /** "You cannot ... attack from one Home Terrain to the other Home Terrain." */
  it('cannot shoot from one Home Terrain to the other', () => {
    const state = fresh()
    expect(missileTargets(state, 'p1', 'p1_home')).not.toContain('p2_home')
    expect([...missileTargets(state, 'p1', 'p1_home')].sort()).toEqual(['frontier', 'p1_home'])
  })
  it('skips terrains where the enemy has nothing', () => {
    const state = emptyArmy(fresh(), 'p2', 'frontier')
    expect(missileTargets(state, 'p1', 'frontier')).not.toContain('frontier')
  })
  it('can never reach the Reserve Army, which is not at a terrain', () => {
    let state = fresh()
    state = emptyArmy(state, 'p2', 'frontier') // sends them to reserve
    for (const slot of missileTargets(state, 'p1', 'frontier')) {
      expect(armyAt(state, 'p2', slot).length).toBeGreaterThan(0)
    }
  })
})
describe('magicDamage', () => {
  it('needs two magic results per point of damage, rounding down', () => {
    expect(magicDamage(7, V0_RULES)).toBe(3)
    expect(magicDamage(6, V0_RULES)).toBe(3)
    expect(magicDamage(1, V0_RULES)).toBe(0)
    expect(magicDamage(0, V0_RULES)).toBe(0)
  })
  it('refuses to guess once real spellcasting is switched on', () => {
    expect(() => magicDamage(7, { ...V0_RULES, magic: 'spells' })).toThrow(/not implemented/)
  })
})
describe('melee', () => {
  it('subtracts saves from the attack to get damage', () => {
    let checked = 0
    for (let seed = 1; seed <= 60; seed++) {
      const state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MELEE_AT_FRONTIER),
        'melee',
      )
      const entry = combatEntries(state)[0]
      if (entry === undefined || entry.saveTotal === null) continue
      expect(entry.damage, `seed ${seed}`).toBe(Math.max(0, entry.attackTotal - entry.saveTotal))
      checked += 1
    }
    expect(checked).toBeGreaterThan(40)
  })
  /** "If the marching army rolled at least 1 melee result, the defending army rolls
   *  for save results." A zero attack earns no save roll at all, not merely no damage. */
  it('makes no save roll at all when the attack generates nothing', () => {
    let seen = 0
    for (let seed = 1; seed <= 400; seed++) {
      const state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MELEE_AT_FRONTIER),
        'melee',
      )
      const entry = combatEntries(state)[0]
      if (entry === undefined || entry.attackTotal !== 0) continue
      expect(entry.saveTotal, `seed ${seed}`).toBeNull()
      expect(entry.damage).toBe(0)
      seen += 1
    }
    expect(seen, 'expected the sweep to contain a zero-result attack').toBeGreaterThan(0)
  })
  it('asks the defender to assign the damage, then offers a counter-attack', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MELEE_AT_FRONTIER),
        'melee',
      )
      if (state.pending?.kind !== 'assign_damage') continue
      expect(state.pending.player).toBe('p2')
      expect(state.pending.slot).toBe('frontier')
      const before = livingUnits(state, 'p2').length
      const { suggestion } = damageSuggestion(state)
      state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      expect(livingUnits(state, 'p2').length).toBe(before - suggestion.length)
      expect(state.pending?.kind, 'melee always offers a counter-attack').toBe(
        'choose_counter_attack',
      )
      expect(state.pending?.player, 'the defender counters').toBe('p2')
      return
    }
    throw new Error('no seed in the sweep produced assignable melee damage')
  })
  it('lets the counter-attack hurt the marching army', () => {
    for (let seed = 1; seed <= 120; seed++) {
      let state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MELEE_AT_FRONTIER),
        'melee',
      )
      if (state.pending?.kind === 'assign_damage') {
        const { suggestion } = damageSuggestion(state)
        state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      }
      if (state.pending?.kind !== 'choose_counter_attack') continue
      state = play(state, { kind: 'choose_counter_attack', counter: true })
      const counter = combatEntries(state).find((e) => e.isCounter)
      if (counter === undefined) continue
      // The counter runs the other way: p2 attacks, p1 defends.
      expect(counter.attacker).toBe('p2')
      expect(counter.defender).toBe('p1')
      if (state.pending?.kind === 'assign_damage') {
        expect(state.pending.player, 'the marcher takes counter damage').toBe('p1')
      }
      return
    }
    throw new Error('no seed in the sweep reached a counter-attack')
  })
  it('ends the march when the counter-attack is declined', () => {
    for (let seed = 1; seed <= 120; seed++) {
      let state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MELEE_AT_FRONTIER),
        'melee',
      )
      if (state.pending?.kind === 'assign_damage') {
        const { suggestion } = damageSuggestion(state)
        state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      }
      if (state.pending?.kind !== 'choose_counter_attack') continue
      state = play(state, { kind: 'choose_counter_attack', counter: false })
      expect(state.turn.marchIndex).toBe(1)
      expect(state.turn.combat).toBeNull()
      return
    }
    throw new Error('no seed in the sweep reached a counter-attack')
  })
})
describe('missile', () => {
  it('never offers a counter-attack', () => {
    for (let seed = 1; seed <= 80; seed++) {
      let state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MISSILE_AT_FRONTIER),
        'missile',
      )
      expect(state.pending?.kind).toBe('choose_missile_target')
      state = play(state, { kind: 'choose_missile_target', slot: 'frontier' })
      if (state.pending?.kind === 'assign_damage') {
        const { suggestion } = damageSuggestion(state)
        state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      }
      expect(state.pending?.kind).not.toBe('choose_counter_attack')
      expect(state.turn.combat).toBeNull()
    }
  })
  it('rejects an unreachable target', () => {
    const state = play(
      begin(setFace(fresh(), 'p1_home', 3)), // swampland face 3 = missile
      { kind: 'choose_march_army', army: 'p1_home' },
      { kind: 'choose_maneuver', maneuver: false },
      { kind: 'choose_action', action: 'missile' },
    )
    expect(state.pending?.kind).toBe('choose_missile_target')
    expect(() => reduce(state, { kind: 'choose_missile_target', slot: 'p2_home' })).toThrow(
      /not a legal missile target/,
    )
  })
})
describe('magic', () => {
  it('allows no save roll and deals half the results, rounded down', () => {
    let checked = 0
    for (let seed = 1; seed <= 80; seed++) {
      const state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MAGIC_AT_FRONTIER),
        'magic',
      )
      const entry = combatEntries(state)[0]
      if (entry === undefined) continue
      expect(entry.saveTotal, `seed ${seed}: magic allows no save`).toBeNull()
      expect(entry.damage, `seed ${seed}`).toBe(Math.floor(entry.attackTotal / 2))
      checked += 1
    }
    expect(checked).toBeGreaterThan(70)
  })
  it('never offers a counter-attack', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let state = attackFromFrontier(
        setFace(fresh(seed, 'p1'), 'frontier', MAGIC_AT_FRONTIER),
        'magic',
      )
      if (state.pending?.kind === 'assign_damage') {
        const { suggestion } = damageSuggestion(state)
        state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      }
      expect(state.pending?.kind).not.toBe('choose_counter_attack')
    }
  })
})
describe('choosing an action', () => {
  it('rejects an action the terrain does not permit', () => {
    const state = play(
      begin(setFace(fresh(), 'frontier', MELEE_AT_FRONTIER)),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: false },
    )
    expect(() => reduce(state, { kind: 'choose_action', action: 'magic' })).toThrow(
      /on a melee face/,
    )
  })
  it('lets the action be skipped', () => {
    const state = play(
      begin(setFace(fresh(), 'frontier', MELEE_AT_FRONTIER)),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: false },
      { kind: 'choose_action', action: null },
    )
    expect(state.turn.marchIndex).toBe(1)
    expect(state.log.some((e) => e.kind === 'action_skipped')).toBe(true)
  })
  it('offers the holder only the actions that have something to hit', () => {
    // p1 maneuvers an undefended Frontier to 8 and captures it. The eighth face
    // grants melee, missile and magic -- but p2 has no army there to melee or
    // magic, so only missile, which reaches their other terrains, survives.
    const state = play(
      begin(emptyArmy(setFace(fresh(), 'frontier', 7), 'p2', 'frontier')),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'choose_direction', direction: 'up' },
    )
    expect(state.terrains.frontier.face).toBe(8)
    expect(state.terrains.frontier.capturedBy).toBe('p1')
    expect(state.pending?.kind).toBe('choose_action')
    expect((state.pending as { legal: readonly string[] }).legal).toEqual(['missile'])
    expect(() => reduce(state, { kind: 'choose_action', action: 'melee' })).toThrow(
      IllegalActionError,
    )
  })
})
describe('elimination through combat', () => {
  /** Leaves p2 with a single die at the Frontier and nothing anywhere else. */
  function lastStand(seed: number): GameState {
    const base = fresh(seed, 'p1')
    const survivor = armyAt(base, 'p2', 'frontier')[0]!
    const units = { ...base.units }
    for (const unit of Object.values(units)) {
      if (unit.owner === 'p2' && unit.id !== survivor.id) {
        units[unit.id] = { ...unit, location: { kind: 'dua' } }
      }
    }
    return setFace({ ...base, units }, 'frontier', MELEE_AT_FRONTIER)
  }
  it('ends the game the moment an attack removes the last enemy unit', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let state = attackFromFrontier(lastStand(seed), 'melee')
      if (state.pending?.kind !== 'assign_damage') continue
      const { suggestion } = damageSuggestion(state)
      if (suggestion.length === 0) continue
      state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      expect(livingUnits(state, 'p2')).toEqual([])
      expect(state.winner).toBe('p1')
      expect(state.turn.phase).toBe('game_over')
      expect(state.pending).toBeNull()
      expect(state.log.some((e) => e.kind === 'victory' && e.reason === 'elimination')).toBe(true)
      // The win lands mid-march: no counter-attack was ever offered.
      expect(state.log.some((e) => e.kind === 'counter_declined')).toBe(false)
      return
    }
    throw new Error('no seed in the sweep killed the last defender')
  })
  it('does not offer a counter-attack from an army that was wiped out', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let state = attackFromFrontier(lastStand(seed), 'melee')
      if (state.pending?.kind !== 'assign_damage') continue
      const { suggestion } = damageSuggestion(state)
      if (suggestion.length === 0) continue
      state = play(state, { kind: 'assign_damage', unitIds: suggestion })
      expect(state.pending?.kind).not.toBe('choose_counter_attack')
      return
    }
    throw new Error('no seed in the sweep killed the last defender')
  })
})

/** Face 8 held by `holder` — `setFace` deliberately clears `capturedBy`, and the
 *  two must always agree (validateState enforces it). */
function captured(state: GameState, slot: TerrainSlot, holder: PlayerId): GameState {
  return {
    ...state,
    terrains: { ...state.terrains, [slot]: { ...state.terrains[slot], face: 8, capturedBy: holder } },
  }
}

describe('the eighth face', () => {
  describe('action restriction', () => {
    it('lets the holder choose melee, missile or magic', () => {
      const state = captured(begin(fresh()), 'frontier', 'p1')
      expect([...legalActions(state, 'p1', 'frontier')].sort()).toEqual([
        'magic',
        'melee',
        'missile',
      ])
    })

    it('restricts the army facing the holder to melee', () => {
      const state = captured(begin(fresh()), 'frontier', 'p1')
      expect(legalActions(state, 'p2', 'frontier')).toEqual(['melee'])
    })

    it('overrides whatever the numbered face would have allowed', () => {
      // terrainAction reports nothing at face 8; the eighth face supplies its own.
      const state = captured(begin(fresh()), 'frontier', 'p1')
      expect(terrainAction(state, 'frontier')).toBeNull()
      expect(legalActions(state, 'p1', 'frontier').length).toBeGreaterThan(0)
    })

    it('still offers nothing when there is nothing to attack', () => {
      const state = emptyArmy(captured(begin(fresh()), 'frontier', 'p1'), 'p2', 'frontier')
      // p2 is gone, so melee and magic have no target; missile can still reach elsewhere.
      expect(legalActions(state, 'p1', 'frontier')).not.toContain('melee')
      expect(legalActions(state, 'p1', 'frontier')).not.toContain('magic')
    })

    it('grants none of it under the captureOnly ruleset', () => {
      const base = captured(begin(fresh()), 'frontier', 'p1')
      const old = { ...base, ruleSet: { ...V0_RULES, eighthFace: 'captureOnly' as const } }
      expect(legalActions(old, 'p1', 'frontier')).toEqual([])
      expect(legalActions(old, 'p2', 'frontier')).toEqual([])
    })
  })

  describe('ID doubling', () => {
    const idFaces = (dice: readonly { face: { icon: string }; results: number }[]) =>
      dice.filter((d) => d.face.icon === 'ID')

    it('doubles ID results and leaves every other face alone', () => {
      const state = begin(fresh())
      const army = armyAt(state, 'p1', 'frontier')
      const [plain] = rollArmy(army, 'melee', state.rng, V0_RULES, false)
      const [bonus] = rollArmy(army, 'melee', state.rng, V0_RULES, true)

      // Same rng in, same faces out -- only the ID results differ.
      expect(bonus.dice.map((d) => d.faceIndex)).toEqual(plain.dice.map((d) => d.faceIndex))
      for (let i = 0; i < plain.dice.length; i++) {
        const before = plain.dice[i]!
        const after = bonus.dice[i]!
        expect(after.results).toBe(before.face.icon === 'ID' ? before.results * 2 : before.results)
      }
      const ids = idFaces(plain.dice)
      const idTotal = ids.reduce((n, d) => n + d.results, 0)
      expect(bonus.total).toBe(plain.total + idTotal)
    })

    it('consumes exactly the same randomness either way', () => {
      const state = begin(fresh())
      const army = armyAt(state, 'p1', 'frontier')
      const [, plainRng] = rollArmy(army, 'melee', state.rng, V0_RULES, false)
      const [, bonusRng] = rollArmy(army, 'melee', state.rng, V0_RULES, true)
      expect(bonusRng).toEqual(plainRng)
    })

    it('applies only to the holder, and only under a ruleset that grants it', () => {
      const held = captured(begin(fresh()), 'frontier', 'p1')
      expect(doublesIds(held, 'p1', 'frontier')).toBe(true)
      expect(doublesIds(held, 'p2', 'frontier')).toBe(false)
      expect(doublesIds(held, 'p1', 'p1_home')).toBe(false)

      const old = { ...held, ruleSet: { ...V0_RULES, eighthFace: 'captureOnly' as const } }
      expect(doublesIds(old, 'p1', 'frontier')).toBe(false)
    })
  })
})
