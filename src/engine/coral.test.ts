/**
 * The Coral Elves in play (v2 Phase 5): the SAIs and abilities that reach into an
 * exchange or a contest, driven through the real step machine.
 *
 * Swallow, Entangle and Ferry are in `targeting.test.ts` beside the SAIs whose shapes
 * they reuse; Tail's reroll is in `sai.test.ts` beside Rend's. What lives here is what
 * is new in kind: Wave, which takes results off the *other* army's roll.
 *
 * Boards are hand-built, because the Coral Elves are not playable until the phase has
 * built everything on their dice (`playable.ts`), and `setupGame` would refuse them.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import { maneuverAsSaves } from './pipeline'
import { advance, reduce } from './reduce'
import { resolveFaces } from './roll'
import { DRAGON_ROLL_KINDS } from './sai'
import { rollDice, type RngState } from './rng'
import {
  V0_RULES,
  type GameState,
  type LogEntry,
  type RuleSet,
  type TerrainSlot,
  type TurnState,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const RULES: RuleSet = { ...V0_RULES, sai: 'full', dua: 'active' }

/** Leviathan: 5 Wave, 6 `4 SAVE`. Knight: 1 `2 MELEE`. Willow: 1 `3 SAVE`, 2 and 3
 *  `2 MANEUVER`. */
const LEVIATHAN = 'coral_elves.leviathan'
const KNIGHT = 'coral_elves.knight'
const WILLOW = 'treefolk.willow'
const WAVE = 5
const KNIGHT_MELEE = 1
const WILLOW_SAVE = 1
const WILLOW_MANEUVER = 2

/** The RNG counter at which these dice, in this order, show these faces. */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 2_000_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

/** p1's dice and p2's dice at the Frontier, with p1 marching and the turn as given. */
function board(
  p1: readonly string[],
  p2: readonly string[],
  rng: RngState,
  turn: Partial<TurnState>,
  options: { readonly ruleSet?: RuleSet; readonly frontier?: string } = {},
): GameState {
  const units: Record<string, UnitInstance> = {}
  for (const [owner, typeIds] of [['p1', p1], ['p2', p2]] as const) {
    typeIds.forEach((typeId, i) => {
      const id = `${owner}:${i}`
      units[id] = { id, typeId, owner, location: { kind: 'terrain', slot: 'frontier' } }
    })
  }
  const terrain = (slot: TerrainSlot) => ({
    slot,
    dieId: slot === 'frontier' ? (options.frontier ?? 'highland_tower') : 'highland_tower',
    face: 6 as const,
    capturedBy: null,
  })
  return {
    ruleSet: options.ruleSet ?? RULES,
    rng,
    units,
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
      combat: null,
      ...turn,
    },
    pending: null,
    log: [],
    winner: null,
  }
}

/** Paused where p2 decides whether to contest p1's maneuver at the Frontier. */
const contestable = (p1: readonly string[], p2: readonly string[], rng: RngState): GameState => ({
  ...board(p1, p2, rng, { marchStep: 'contest_maneuver' }),
  pending: { kind: 'contest_maneuver', player: 'p2', slot: 'frontier' },
})

const logged = <K extends LogEntry['kind']>(state: GameState, kind: K) =>
  state.log.find((e): e is Extract<LogEntry, { kind: K }> => e.kind === kind)

describe('Wave', () => {
  it('takes X save results off the defending army in a melee attack', () => {
    const state = advance(
      board([LEVIATHAN, KNIGHT], [WILLOW], rngShowing([LEVIATHAN, KNIGHT, WILLOW], [WAVE, KNIGHT_MELEE, WILLOW_SAVE]), {
        combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
      }),
    )
    // Two melee against three saves would do nothing; the Wave takes four off the saves.
    const exchange = logged(state, 'combat_resolved')
    expect(exchange).toMatchObject({ attackTotal: 2, saveTotal: 0 })
    expect(exchange?.saveMath?.steps).toContainEqual(expect.objectContaining({ source: 'Wave', delta: -3 }))
    expect(state.pending).toMatchObject({ kind: 'assign_damage', player: 'p2' })
    expect(validateState(state)).toEqual([])
  })

  it('takes X off the counter-maneuvering army when the marcher rolls it', () => {
    const state = reduce(
      contestable([LEVIATHAN], [WILLOW, WILLOW], rngShowing([LEVIATHAN, WILLOW, WILLOW], [WAVE, WILLOW_MANEUVER, WILLOW_MANEUVER])),
      { kind: 'contest_maneuver', contest: true },
    )
    // Four maneuver against none would win the contest; less the Wave's four it ties,
    // and the marcher wins a tie.
    expect(logged(state, 'maneuver_contested')).toMatchObject({ marcher: 0, defender: 0, marcherWins: true })
    expect(state.turn.marchStep).toBe('choose_direction')
  })

  it('does nothing when rolled on a counter-maneuver', () => {
    const state = reduce(
      contestable([WILLOW, WILLOW], [LEVIATHAN], rngShowing([WILLOW, WILLOW, LEVIATHAN], [WILLOW_MANEUVER, WILLOW_MANEUVER, WAVE])),
      { kind: 'contest_maneuver', contest: true },
    )
    expect(logged(state, 'maneuver_contested')).toMatchObject({ marcher: 4, defender: 0, marcherWins: true })
  })
})

describe('Hypnotic Glare', () => {
  /** Leviathan face 7 is Hypnotic Glare. Willow face 0 is its ID, 1 is `3 SAVE`. */
  const GLARE = 7
  const WILLOW_ID = 0

  const glared = () =>
    advance(
      board(
        [LEVIATHAN, KNIGHT],
        [WILLOW, WILLOW],
        rngShowing([LEVIATHAN, KNIGHT, WILLOW, WILLOW], [GLARE, KNIGHT_MELEE, WILLOW_ID, WILLOW_SAVE]),
        { combat: { action: 'melee', targetSlot: 'frontier', damage: 0 } },
      ),
    )

  it('hypnotizes the defenders that rolled an ID, and does not count their results', () => {
    const state = glared()
    // The first Willow's ID was worth two saves; hypnotized, only the other's three count.
    expect(logged(state, 'combat_resolved')).toMatchObject({ attackTotal: 2, saveTotal: 3 })
    expect(logged(state, 'sai_resolved')).toMatchObject({ sai: 'Hypnotic Glare', unitIds: ['p2:0'] })

    const hypnotized = state.effects.filter((e) => e.hypnotized === true)
    expect(hypnotized.map((e) => e.target)).toEqual([{ kind: 'unit', unitId: 'p2:0' }])
    expect(hypnotized[0]).toMatchObject({
      anchor: { unitId: 'p1:0', slot: 'frontier', untilRolled: true },
      expiresAtStartOfTurnOf: 'p1',
    })
    // The Leviathan keeps its glare alive by sitting out its army's rolls.
    expect(state.effects.filter((e) => e.glaring === true).map((e) => e.target)).toEqual([
      { kind: 'unit', unitId: 'p1:0' },
    ])
    expect(validateState(state)).toEqual([])
  })

  it('keeps both out of the counter-attack: the hypnotized die cannot roll, the glaring one sits out', () => {
    const offered = glared()
    expect(offered.pending).toMatchObject({ kind: 'choose_counter_attack', player: 'p2' })
    // Willow face 5 is `3 MELEE`, Knight face 5 is `2 SAVE`: a counter with a save roll.
    const pinned = { ...offered, rng: rngShowing([WILLOW, KNIGHT], [5, 5]) }
    const countered = advance(reduce(pinned, { kind: 'choose_counter_attack', counter: true }))
    const exchange = countered.log.filter((e) => e.kind === 'combat_resolved').at(-1)
    if (exchange?.kind !== 'combat_resolved') throw new Error('no counter-attack resolved')
    // One Willow attacked and one Knight saved: the hypnotized Willow and the glaring
    // Leviathan both sat out.
    expect(exchange.attackDice.map((d) => d.unitId)).toEqual(['p2:1'])
    expect(exchange.saveDice?.map((d) => d.unitId)).toEqual(['p1:1'])
  })

  it('does nothing, not even glare, when no defender rolled an ID', () => {
    const state = advance(
      board(
        [LEVIATHAN, KNIGHT],
        [WILLOW, WILLOW],
        rngShowing([LEVIATHAN, KNIGHT, WILLOW, WILLOW], [GLARE, KNIGHT_MELEE, WILLOW_SAVE, WILLOW_SAVE]),
        { combat: { action: 'melee', targetSlot: 'frontier', damage: 0 } },
      ),
    )
    expect(state.effects).toEqual([])
    expect(logged(state, 'sai_resolved')).toBeUndefined()
  })
})

describe('Coastal Dodge', () => {
  /** Knight face 2 is `3 MANEUVER`; Willow face 2 is `2 MANEUVER`. Coastland is air and
   *  water, Highland fire and earth. */
  const KNIGHT_MANEUVER = 2
  const ABILITIES: RuleSet = { ...RULES, speciesAbilities: true }

  /** Oak Lords attack at the Frontier, and whatever p2 stands there saves. */
  const saving = (defenders: readonly string[], faces: readonly number[], frontier: string) =>
    advance(
      board(
        ['treefolk.oak_lord'],
        defenders,
        // Oak Lord face 1 is `3 MELEE`.
        rngShowing(['treefolk.oak_lord', ...defenders], [1, ...faces]),
        { combat: { action: 'melee', targetSlot: 'frontier', damage: 0 } },
        { ruleSet: ABILITIES, frontier },
      ),
    )

  it("counts a Coral Elf's maneuver as saves at a terrain containing water", () => {
    const state = saving([KNIGHT], [KNIGHT_MANEUVER], 'coastland_tower')
    const exchange = logged(state, 'combat_resolved')
    expect(exchange).toMatchObject({ attackTotal: 3, saveTotal: 3 })
    expect(exchange?.saveMath?.notes).toContain('3 maneuver counted as saves (Coastal Dodge)')
    // The die draws its three, so the strip adds up to the total.
    expect(exchange?.saveDice?.map((d) => d.results)).toEqual([3])
  })

  it('does nothing at a terrain without water', () => {
    const state = saving([KNIGHT], [KNIGHT_MANEUVER], 'highland_tower')
    expect(logged(state, 'combat_resolved')).toMatchObject({ saveTotal: 0 })
  })

  it('converts only the Coral Elves in a mixed army', () => {
    const state = saving([KNIGHT, WILLOW], [KNIGHT_MANEUVER, WILLOW_MANEUVER], 'coastland_tower')
    expect(logged(state, 'combat_resolved')).toMatchObject({ saveTotal: 3 })
  })

  it('is off without species abilities', () => {
    const state = advance(
      board(
        ['treefolk.oak_lord'],
        [KNIGHT],
        rngShowing(['treefolk.oak_lord', KNIGHT], [1, KNIGHT_MANEUVER]),
        { combat: { action: 'melee', targetSlot: 'frontier', damage: 0 } },
        { frontier: 'coastland_tower' },
      ),
    )
    expect(logged(state, 'combat_resolved')).toMatchObject({ saveTotal: 0 })
  })

  it('leaves a maneuver roll alone, where converting could only hurt', () => {
    const state = reduce(
      {
        ...board([WILLOW], [KNIGHT], rngShowing([WILLOW, KNIGHT], [WILLOW_MANEUVER, KNIGHT_MANEUVER]), { marchStep: 'contest_maneuver' }, {
          ruleSet: ABILITIES,
          frontier: 'coastland_tower',
        }),
        pending: { kind: 'contest_maneuver', player: 'p2', slot: 'frontier' },
      },
      { kind: 'contest_maneuver', contest: true },
    )
    expect(logged(state, 'maneuver_contested')).toMatchObject({ marcher: 2, defender: 3, marcherWins: false })
  })

  it('converts every maneuver in the dragon combination roll too, which counts saves and not maneuver', () => {
    const outcome = resolveFaces(
      [{ unitId: 'k', typeId: KNIGHT, faceIndex: KNIGHT_MANEUVER }],
      {
        kinds: DRAGON_ROLL_KINDS,
        modifiers: [maneuverAsSaves(['coral_elves'], 'Coastal Dodge')],
        context: { purpose: { kind: 'dragon_attack' }, isCounter: false },
        // No ID on the table, so nothing to allocate -- but a combination roll must say so.
        idAllocation: {},
      },
      ABILITIES,
    )
    expect(outcome.totals.save).toBe(3)
  })
})

describe('Defensive Volley', () => {
  /** Pine: 5 is `3 SAVE`, no missile. Archer: 2 is `3 MISSILE`. */
  const PINE = 'treefolk.pine'
  const ARCHER = 'coral_elves.archer'
  const PINE_SAVE = 5
  const ARCHER_MISSILE = 2
  const ABILITIES: RuleSet = { ...RULES, speciesAbilities: true }

  /**
   * p1's Pine shoots from its home at p2's army at the Frontier, and rolls nothing -- so
   * no save roll, no damage, and the exchange walks straight on to the counter.
   */
  const shotAt = (defenders: readonly string[], rng: RngState, options: { ruleSet?: RuleSet; frontier?: string } = {}) => {
    const base = board([PINE], defenders, rng, {}, {
      ruleSet: options.ruleSet ?? ABILITIES,
      frontier: options.frontier ?? 'coastland_tower',
    })
    const units = { ...base.units, 'p1:0': { ...base.units['p1:0']!, location: { kind: 'terrain', slot: 'p1_home' } as const } }
    return advance({
      ...base,
      units,
      turn: {
        ...base.turn,
        marchingArmy: 'p1_home',
        armiesMarched: ['p1_home'],
        marchStep: 'resolve_attack',
        combat: { action: 'missile', targetSlot: 'frontier', damage: 0 },
      },
    })
  }

  it('offers the Coral Elves at an air terrain a missile counter-attack at the army that shot', () => {
    const offered = shotAt([ARCHER], rngShowing([PINE, ARCHER, PINE], [PINE_SAVE, ARCHER_MISSILE, PINE_SAVE]))
    expect(offered.pending).toEqual({
      kind: 'choose_counter_attack',
      player: 'p2',
      slot: 'frontier',
      volley: { target: 'p1_home' },
    })

    const volleyed = advance(reduce(offered, { kind: 'choose_counter_attack', counter: true }))
    const counter = volleyed.log.filter((e) => e.kind === 'combat_resolved').at(-1)
    expect(counter).toMatchObject({
      action: 'missile',
      isCounter: true,
      attackerSlot: 'frontier',
      defenderSlot: 'p1_home',
      attackTotal: 3,
      saveTotal: 3,
    })
    expect(validateState(volleyed)).toEqual([])
  })

  it('is thrown by the Coral Elves alone in a mixed army', () => {
    const offered = shotAt([ARCHER, WILLOW], rngShowing([PINE, ARCHER, PINE], [PINE_SAVE, ARCHER_MISSILE, PINE_SAVE]))
    const volleyed = advance(reduce(offered, { kind: 'choose_counter_attack', counter: true }))
    const counter = volleyed.log.filter((e) => e.kind === 'combat_resolved').at(-1)
    if (counter?.kind !== 'combat_resolved') throw new Error('no volley resolved')
    expect(counter.attackDice.map((d) => d.unitId)).toEqual(['p2:0'])
  })

  it('offers nothing at a terrain without air, or with the abilities off', () => {
    const rng = rngShowing([PINE], [PINE_SAVE])
    for (const state of [shotAt([ARCHER], rng, { frontier: 'highland_tower' }), shotAt([ARCHER], rng, { ruleSet: RULES })]) {
      expect(state.pending?.kind).not.toBe('choose_counter_attack')
      expect(state.turn.combat).toBeNull()
    }
  })

  it('offers nothing to an army with no Coral Elf in it', () => {
    const state = shotAt([WILLOW], rngShowing([PINE], [PINE_SAVE]))
    expect(state.pending?.kind).not.toBe('choose_counter_attack')
  })

  it('may be declined, and the march ends', () => {
    const offered = shotAt([ARCHER], rngShowing([PINE], [PINE_SAVE]))
    const declined = advance(reduce(offered, { kind: 'choose_counter_attack', counter: false }))
    expect(declined.log.at(-1)?.kind === 'counter_declined' || declined.log.some((e) => e.kind === 'counter_declined')).toBe(true)
    expect(declined.turn.combat).toBeNull()
  })
})

describe('Ferry carrying another free mover', () => {
  /** Gryphon face 4 is Ferry; Unicorn face 3 is Teleport. */
  const GRYPHON = 'coral_elves.gryphon'
  const UNICORN = 'treefolk.unicorn'

  /**
   * Found by the 1000-game fuzz once Ferry joined Teleport in mixed forces: the Ferry
   * carried the Unicorn away, and the Unicorn's own free move was then offered every
   * terrain but the one its army rolled at -- including the one it now stood on.
   */
  it('moves the carried die from where it stands now, with the army it stands in', () => {
    const start = advance(
      board([GRYPHON, UNICORN], [WILLOW], rngShowing([GRYPHON, UNICORN], [4, 3]), {
        combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
      }),
    )
    expect(start.pending).toMatchObject({ kind: 'sai_move', sai: 'Ferry', unitId: 'p1:0', slot: 'frontier' })

    const ferried = advance(reduce(start, { kind: 'sai_move', slot: 'p1_home', unitIds: ['p1:1'] }))
    expect(ferried.units['p1:1']?.location).toEqual({ kind: 'terrain', slot: 'p1_home' })
    expect(ferried.pending).toMatchObject({ kind: 'sai_move', sai: 'Teleport', unitId: 'p1:1', slot: 'p1_home' })
    const options = (ferried.pending as { options: readonly string[] }).options
    expect(options).not.toContain('p1_home')
    expect(options).toContain('frontier')

    // Its passengers are the army it stands in now: the Gryphon it came with is in it
    // (though at four health it does not fit Teleport's three), and nobody left behind is.
    expect(() => reduce(ferried, { kind: 'sai_move', slot: 'frontier', unitIds: ['p1:0'] })).toThrow(/up to 3/)
    const back = reduce(ferried, { kind: 'sai_move', slot: 'frontier', unitIds: [] })
    expect(back.units['p1:1']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    expect(validateState(back)).toEqual([])
  })
})

describe('Ferry out of Reserves', () => {
  /** Gryphon face 4 is Ferry. */
  const GRYPHON = 'coral_elves.gryphon'
  const SPELLS: RuleSet = { ...RULES, magic: 'spells' }

  /** p1's Gryphon and Knight in Reserves, taking the Reserve Army's magic action. */
  function reserveMagic(): GameState {
    const state = board([GRYPHON, KNIGHT], [WILLOW], rngShowing([GRYPHON, KNIGHT], [4, KNIGHT_MELEE]), {
      marchingArmy: 'reserve',
      armiesMarched: ['reserve'],
      combat: { action: 'magic', targetSlot: 'reserve', damage: 0 },
    }, { ruleSet: SPELLS })
    const units = { ...state.units }
    for (const id of ['p1:0', 'p1:1']) units[id] = { ...units[id]!, location: { kind: 'reserve' } }
    return { ...state, units }
  }

  /**
   * Reported from a browser: a Reserve Army's magic roll came up Ferry, the roll card
   * marked it, and then nothing -- `taskHasWork` asked for a mover at a terrain and
   * dropped the task, though `taskPending` had offered every terrain from Reserves
   * since v1 Phase 5d. "During any non-maneuver roll ... to any terrain" names no
   * starting point, and a magic roll is a non-maneuver roll.
   */
  it('is offered, and carries the mover and its passengers to a terrain', () => {
    const start = advance(reserveMagic())
    expect(start.pending).toMatchObject({
      kind: 'sai_move',
      sai: 'Ferry',
      unitId: 'p1:0',
      slot: 'reserve',
      options: ['p1_home', 'frontier', 'p2_home'],
    })

    const ferried = advance(reduce(start, { kind: 'sai_move', slot: 'frontier', unitIds: ['p1:1'] }))
    expect(ferried.units['p1:0']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    expect(ferried.units['p1:1']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    expect(logged(ferried, 'units_moved')).toMatchObject({ from: 'reserve', to: 'frontier' })
    expect(validateState(ferried)).toEqual([])
  })

  it('may still stay put', () => {
    const start = advance(reserveMagic())
    const stayed = advance(reduce(start, { kind: 'sai_move', slot: null, unitIds: [] }))
    expect(stayed.units['p1:0']?.location).toEqual({ kind: 'reserve' })
    expect(validateState(stayed)).toEqual([])
  })
})
