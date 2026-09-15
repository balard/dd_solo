import { describe, expect, it } from 'vitest'

import { begin, reduce } from './reduce'
import { setupGame, STARTER_FORCES } from './setup'
import { findVictory, legalDirections, marchableArmies } from './turn'
import {
  IllegalActionError,
  TERRAIN_SLOTS,
  armyAt,
  capturedCount,
  reserveArmy,
  type GameAction,
  type GameState,
  type PlayerId,
  type TerrainFace,
  type TerrainSlot,
} from './types'
import { validateState } from './validate'

const fresh = (seed = 1234, firstPlayer: PlayerId = 'p1') =>
  setupGame({ seed, forces: STARTER_FORCES, firstPlayer })

/** Drives a script of decisions, checking the state stays valid throughout. */
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

// --- crafting helpers, so a position can be set up directly ------------------

function emptyArmy(state: GameState, player: PlayerId, slot: TerrainSlot): GameState {
  const units = { ...state.units }
  for (const unit of armyAt(state, player, slot)) {
    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
  }
  return { ...state, units }
}

function setFace(
  state: GameState,
  slot: TerrainSlot,
  face: TerrainFace,
  capturedBy: PlayerId | null = null,
): GameState {
  return {
    ...state,
    terrains: { ...state.terrains, [slot]: { ...state.terrains[slot], face, capturedBy } },
  }
}

describe('getting the game running', () => {
  it('advances from setup to the first real decision', () => {
    const state = begin(fresh())
    expect(state.turn.phase).toBe('march')
    expect(state.pending?.kind).toBe('choose_march_army')
    expect(state.pending?.player).toBe('p1')
  })

  it('passes straight through the three no-op phases', () => {
    const state = begin(fresh())
    // They are real phases, so nothing needed inserting -- but they ask nothing.
    expect(state.turn.marchIndex).toBe(0)
    expect(state.turn.marchStep).toBe('select_army')
  })

  it('offers every terrain where the marching player has an army', () => {
    const state = begin(fresh())
    expect([...(state.pending as { options: readonly string[] }).options].sort()).toEqual(
      [...TERRAIN_SLOTS].sort(),
    )
  })

  it('never offers the Reserve Army, which cannot march in v0', () => {
    const state = begin(fresh())
    expect(marchableArmies(state, 'p1')).not.toContain('reserve')
  })
})

describe('march selection', () => {
  it('refuses to march the same army twice in a turn', () => {
    let state = begin(fresh())
    state = play(
      state,
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: false },
      { kind: 'choose_action', action: null },
    )

    expect(state.turn.marchIndex).toBe(1)
    expect(marchableArmies(state, 'p1')).not.toContain('frontier')
    expect(() => reduce(state, { kind: 'choose_march_army', army: 'frontier' })).toThrow(
      /already marched this turn/,
    )
  })

  it('lets a march be skipped', () => {
    let state = begin(fresh())
    state = play(state, { kind: 'choose_march_army', army: null })
    expect(state.turn.marchIndex).toBe(1)
    expect(state.turn.armiesMarched).toEqual([])
  })

  it('reaches the Reserves Phase after both marches are skipped', () => {
    const state = play(
      begin(fresh()),
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
    )
    // Nothing is in reserve at setup, so Reinforce is skipped automatically.
    expect(state.turn.phase).toBe('reserves_retreat')
    expect(state.pending?.kind).toBe('retreat')
  })

  it('passes the turn to the opponent after the Reserves Phase', () => {
    const state = play(
      begin(fresh()),
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
      { kind: 'retreat', unitIds: [] },
    )
    expect(state.turn.marching).toBe('p2')
    expect(state.turn.armiesMarched).toEqual([])
    expect(state.pending?.player).toBe('p2')
    expect(state.log.some((e) => e.kind === 'turn_end')).toBe(true)
  })
})

describe('maneuvering', () => {
  it('skips the contest when the opponent has no army there', () => {
    const state = play(
      begin(emptyArmy(fresh(), 'p2', 'frontier')),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
    )
    expect(state.pending?.kind).toBe('choose_direction')
  })

  it('asks the opponent to contest when they are present', () => {
    const state = play(
      begin(fresh()),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
    )
    expect(state.pending?.kind).toBe('contest_maneuver')
    // The decision belongs to the defender, not the marching player.
    expect(state.pending?.player).toBe('p2')
  })

  /**
   * The direction is chosen *after* the contest resolves, never before. That
   * ordering is the whole reason maneuvering is three steps: the opponent has to
   * decide whether to contest without knowing which way the terrain is going.
   */
  it('does not reveal the direction before the contest is decided', () => {
    const state = play(
      begin(fresh()),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
    )
    expect(JSON.stringify(state.pending)).not.toMatch(/up|down/)
  })

  it('moves the terrain one face when allowed', () => {
    const before = setFace(fresh(), 'frontier', 4)
    const state = play(
      begin(before),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'contest_maneuver', contest: false },
      { kind: 'choose_direction', direction: 'up' },
    )
    expect(state.terrains.frontier.face).toBe(5)
  })

  it('moves down as well as up', () => {
    const state = play(
      begin(setFace(fresh(), 'frontier', 4)),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'contest_maneuver', contest: false },
      { kind: 'choose_direction', direction: 'down' },
    )
    expect(state.terrains.frontier.face).toBe(3)
  })

  it('leaves the terrain alone when the maneuver is declined', () => {
    const before = setFace(fresh(), 'frontier', 4)
    const state = play(
      begin(before),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: false },
    )
    expect(state.terrains.frontier.face).toBe(4)
    expect(state.pending?.kind).toBe('choose_action')
  })

  it('offers only the legal directions at the extremes', () => {
    expect(legalDirections(1)).toEqual(['up'])
    expect(legalDirections(8)).toEqual(['down'])
    expect([...legalDirections(4)].sort()).toEqual(['down', 'up'])
  })

  it('refuses to move below face 1', () => {
    const state = play(
      begin(setFace(emptyArmy(fresh(), 'p2', 'frontier'), 'frontier', 1)),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
    )
    expect((state.pending as { options: readonly string[] }).options).toEqual(['up'])
    expect(() => reduce(state, { kind: 'choose_direction', direction: 'down' })).toThrow(
      IllegalActionError,
    )
  })

  /**
   * "The highest total wins (the marching army wins a tie)." Ties are the part worth
   * pinning down, so this sweeps seeds until it has seen real ones.
   */
  it('gives ties to the marching army', () => {
    let ties = 0
    let contests = 0

    for (let seed = 1; seed <= 250; seed++) {
      const state = play(
        begin(fresh(seed, 'p1')),
        { kind: 'choose_march_army', army: 'frontier' },
        { kind: 'choose_maneuver', maneuver: true },
        { kind: 'contest_maneuver', contest: true },
      )

      const entry = state.log.find((e) => e.kind === 'maneuver_contested')
      if (entry?.kind !== 'maneuver_contested') continue
      contests += 1

      expect(entry.marcherWins, `seed ${seed}: ${entry.marcher} vs ${entry.defender}`).toBe(
        entry.marcher >= entry.defender,
      )
      if (entry.marcher === entry.defender) {
        ties += 1
        expect(entry.marcherWins, `seed ${seed} was a tie`).toBe(true)
      }
    }

    expect(contests).toBeGreaterThan(200)
    expect(ties, 'expected the sweep to contain real ties').toBeGreaterThan(0)
  })

  it('leaves the terrain where it is when the marcher loses the contest', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const before = setFace(fresh(seed, 'p1'), 'frontier', 4)
      const state = play(
        begin(before),
        { kind: 'choose_march_army', army: 'frontier' },
        { kind: 'choose_maneuver', maneuver: true },
        { kind: 'contest_maneuver', contest: true },
      )
      const entry = state.log.find((e) => e.kind === 'maneuver_contested')
      if (entry?.kind !== 'maneuver_contested' || entry.marcherWins) continue

      expect(state.terrains.frontier.face).toBe(4)
      expect(state.pending?.kind).toBe('choose_action')
      return
    }
    throw new Error('no seed in the sweep produced a lost contest')
  })
})

describe('capture', () => {
  const atSeven = () => setFace(emptyArmy(fresh(), 'p2', 'frontier'), 'frontier', 7)

  const captureFrontier = (state: GameState) =>
    play(
      begin(state),
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'choose_direction', direction: 'up' },
    )

  it('captures a terrain maneuvered onto its eighth face', () => {
    const state = captureFrontier(atSeven())
    expect(state.terrains.frontier.face).toBe(8)
    expect(state.terrains.frontier.capturedBy).toBe('p1')
    expect(capturedCount(state, 'p1')).toBe(1)
    expect(state.log.some((e) => e.kind === 'terrain_captured')).toBe(true)
  })

  it('does not end the game on a single capture', () => {
    expect(captureFrontier(atSeven()).winner).toBeNull()
  })

  it('loses the capture when an opposing army maneuvers the terrain down', () => {
    // p1 holds the Frontier on face 8; p2 marches there and pushes it back.
    let state = setFace(fresh(1234, 'p2'), 'frontier', 8, 'p1')
    state = begin(state)

    state = play(
      state,
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'contest_maneuver', contest: false },
      { kind: 'choose_direction', direction: 'down' },
    )

    expect(state.terrains.frontier.face).toBe(7)
    expect(state.terrains.frontier.capturedBy).toBeNull()
    expect(capturedCount(state, 'p1')).toBe(0)
    expect(
      state.log.some((e) => e.kind === 'terrain_lost' && e.reason === 'maneuvered'),
    ).toBe(true)
  })

  it('loses the capture when the holder abandons the terrain', () => {
    // p1 holds p1_home on face 8, then retreats every unit there to reserve.
    let state = setFace(fresh(1234, 'p1'), 'p1_home', 8, 'p1')
    state = begin(state)
    const garrison = armyAt(state, 'p1', 'p1_home').map((u) => u.id)

    state = play(
      state,
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
      { kind: 'retreat', unitIds: garrison },
    )

    expect(state.terrains.p1_home.face).toBe(7)
    expect(state.terrains.p1_home.capturedBy).toBeNull()
    expect(state.log.some((e) => e.kind === 'terrain_lost' && e.reason === 'abandoned')).toBe(true)
  })
})

describe('victory', () => {
  it('finds no winner in a fresh game', () => {
    expect(findVictory(begin(fresh()))).toBeNull()
  })

  /**
   * The phase's exit criterion: a scripted game of pure maneuvering reaches a
   * capture win -- and the win lands the moment the second terrain flips, not at
   * end of turn.
   */
  it('ends immediately on the second capture', () => {
    let state = fresh(1234, 'p1')
    state = emptyArmy(state, 'p2', 'frontier')
    state = emptyArmy(state, 'p2', 'p1_home')
    state = setFace(state, 'frontier', 7)
    state = setFace(state, 'p1_home', 7)

    state = play(
      begin(state),
      // First march: take the Frontier.
      { kind: 'choose_march_army', army: 'frontier' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'choose_direction', direction: 'up' },
      { kind: 'choose_action', action: null },
      // Second march: take p1's home terrain, which wins the game.
      { kind: 'choose_march_army', army: 'p1_home' },
      { kind: 'choose_maneuver', maneuver: true },
      { kind: 'choose_direction', direction: 'up' },
    )

    expect(capturedCount(state, 'p1')).toBe(2)
    expect(state.winner).toBe('p1')
    expect(state.turn.phase).toBe('game_over')
    expect(state.pending).toBeNull()
    expect(state.log.some((e) => e.kind === 'victory' && e.reason === 'captures')).toBe(true)

    // The game ended mid-march: the Reserves Phase was never reached.
    expect(state.log.some((e) => e.kind === 'turn_end')).toBe(false)
  })

  it('refuses any further action once won', () => {
    let state = fresh(1234, 'p1')
    state = emptyArmy(state, 'p2', 'frontier')
    state = setFace(state, 'frontier', 8, 'p1')
    state = setFace(state, 'p1_home', 8, 'p1')

    const finished = begin(state)
    expect(finished.winner).toBe('p1')
    expect(() => reduce(finished, { kind: 'choose_march_army', army: null })).toThrow(
      /the game is over/,
    )
  })

  it('awards victory by elimination', () => {
    let state = fresh(1234, 'p1')
    const units = { ...state.units }
    for (const unit of Object.values(units)) {
      if (unit.owner === 'p2') units[unit.id] = { ...unit, location: { kind: 'dua' } }
    }
    state = begin({ ...state, units })

    expect(state.winner).toBe('p1')
    expect(state.log.some((e) => e.kind === 'victory' && e.reason === 'elimination')).toBe(true)
  })
})

describe('reserves phase', () => {
  it('skips Reinforce when the Reserve Area is empty', () => {
    const state = play(
      begin(fresh()),
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
    )
    expect(state.pending?.kind).toBe('retreat')
  })

  it('offers Reinforce once something is in reserve, and moves it back out', () => {
    // p2 retreats its Frontier army, then reinforces it on its next turn.
    let state = begin(fresh(1234, 'p2'))
    const retreating = armyAt(state, 'p2', 'frontier').map((u) => u.id)

    state = play(
      state,
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
      { kind: 'retreat', unitIds: retreating },
    )
    expect(reserveArmy(state, 'p2')).toHaveLength(retreating.length)

    // p1's whole turn.
    state = play(
      state,
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
      { kind: 'retreat', unitIds: [] },
    )

    // Back to p2, who is now asked to reinforce.
    state = play(
      state,
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
    )
    expect(state.pending?.kind).toBe('reinforce')

    state = play(state, {
      kind: 'reinforce',
      moves: retreating.map((unitId) => ({ unitId, slot: 'p2_home' as const })),
    })
    expect(reserveArmy(state, 'p2')).toEqual([])
    expect(armyAt(state, 'p2', 'p2_home').length).toBeGreaterThan(retreating.length)
  })

  it('rejects reinforcing a unit that is not in reserve', () => {
    let state = begin(fresh(1234, 'p2'))
    const retreating = armyAt(state, 'p2', 'frontier').map((u) => u.id)
    state = play(
      state,
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
      { kind: 'retreat', unitIds: retreating },
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
      { kind: 'retreat', unitIds: [] },
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
    )

    const stillDeployed = armyAt(state, 'p2', 'p2_home')[0]!.id
    expect(() =>
      reduce(state, { kind: 'reinforce', moves: [{ unitId: stillDeployed, slot: 'frontier' }] }),
    ).toThrow(/not in the Reserve Area/)
  })

  it('rejects retreating a unit that is not yours', () => {
    const state = play(
      begin(fresh()),
      { kind: 'choose_march_army', army: null },
      { kind: 'choose_march_army', army: null },
    )
    const enemy = armyAt(state, 'p2', 'frontier')[0]!.id
    expect(() => reduce(state, { kind: 'retreat', unitIds: [enemy] })).toThrow(/not yours/)
  })
})
