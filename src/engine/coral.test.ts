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
        modifiers: [maneuverAsSaves(['coral_elves'])],
        context: { purpose: { kind: 'dragon_attack' }, isCounter: false },
        // No ID on the table, so nothing to allocate -- but a combination roll must say so.
        idAllocation: {},
      },
      ABILITIES,
    )
    expect(outcome.totals.save).toBe(3)
  })
})
