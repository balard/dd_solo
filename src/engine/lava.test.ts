/**
 * The Lava Elves (v2 Phase 8), and the seams their rules stand on.
 *
 * 8b built the machinery before anything used it, so its tests drive each piece
 * directly: the melee sub-roll Web and Charm will roll, the save-roll bench Charm will
 * fill, the hold fate Web will share with Net, the one targeting restriction Illusion
 * will write, and the "counts as" types Necromantic Wave and Volcanic Adaptation need.
 *
 * Boards are hand-built, because the Lava Elves are not playable until 8e and
 * `setupGame` would refuse them.
 */
import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, unitType } from '../data/load'
import { spell } from '../data/spells'
import { expectedArmy } from '../ai/estimate'

import { missileTargets, volleyers } from './combat'
import { armyRoll, shielded, type Effect } from './effects'
import { spellTargets } from './magic'
import { maneuverAsSaves, type Modifier } from './pipeline'
import { advance, reduce } from './reduce'
import { rollDice, type RngState } from './rng'
import { conversionsIn, expectNoEffects, resolveFaces, rollUnits, subRollContext, type RawDie } from './roll'
import { LIVE_SAIS, TARGETING_SAIS, heldWord, saiEffects, type RollContext, type RollPurpose } from './sai'
import {
  V0_RULES,
  type CombatState,
  type GameState,
  type LogEntry,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type TurnState,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const RULES: RuleSet = {
  ...V0_RULES,
  sai: 'full',
  dua: 'active',
  speciesAbilities: true,
  eighthFace: 'full',
  magic: 'spells',
  dragons: true,
}

const OAK = 'treefolk.oak'
const WATCHER = 'firewalkers.watcher'
const FIRESHADOW = 'firewalkers.fireshadow'
const BOWMAN = 'coral_elves.bowman'
/** Oak: face 0 `2 ID`, 1-4 `2 MELEE`, 5 `4 SAVE`. */
const OAK_SAVE = 5

interface Die {
  readonly typeId: string
  readonly at?: UnitInstance['location']
}

/** p1's and p2's dice (at the Frontier unless placed), p1 to march. */
function board(
  p1: readonly (string | Die)[],
  p2: readonly (string | Die)[],
  options: { rng?: RngState; turn?: Partial<TurnState>; dieId?: string; effects?: readonly Effect[] } = {},
): GameState {
  const units: Record<string, UnitInstance> = {}
  for (const [owner, dice] of [['p1', p1], ['p2', p2]] as const) {
    dice.forEach((die, i) => {
      const id = `${owner}:${i}`
      const { typeId, at } = typeof die === 'string' ? { typeId: die, at: undefined } : die
      units[id] = { id, typeId, owner, location: at ?? { kind: 'terrain', slot: 'frontier' } }
    })
  }
  const terrain = (slot: TerrainSlot) => ({
    slot,
    dieId: options.dieId ?? 'highland_tower',
    face: 6 as const,
    capturedBy: null,
  })
  return {
    ruleSet: RULES,
    rng: options.rng ?? { seed: 1, counter: 0 },
    units,
    effects: options.effects ?? [],
    dragons: {},
    terrains: { p1_home: terrain('p1_home'), frontier: terrain('frontier'), p2_home: terrain('p2_home') },
    turn: {
      marching: 'p1',
      phase: 'march',
      marchIndex: 0,
      marchStep: 'select_army',
      marchingArmy: null,
      armiesMarched: [],
      combat: null,
      ...options.turn,
    },
    pending: null,
    log: [],
    winner: null,
  }
}

const entries = <K extends LogEntry['kind']>(state: GameState, kind: K) =>
  state.log.filter((e): e is Extract<LogEntry, { kind: K }> => e.kind === kind)

const faceOf = (typeId: string, label: string): number => {
  const index = unitType(typeId).faces.findIndex((f) => (f.icon === 'SAI' ? `SAI:${f.sai}` : f.icon) === label)
  if (index < 0) throw new Error(`${typeId} has no ${label} face`)
  return index
}

/** The RNG counter at which these dice, in this order, show these faces. */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 400_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

/** An Illusion on `player`'s army at `ref`, cast by them. */
const illusion = (player: PlayerId, ref: TerrainSlot | 'reserve'): Effect => ({
  source: 'Illusion',
  target: { kind: 'army', player, army: ref },
  modifiers: [],
  illusion: true,
  expiresAtStartOfTurnOf: player,
})

// --- 1. a melee sub-roll ---------------------------------------------------------------

describe('a melee sub-roll', () => {
  const meleeAttack: RollContext = { purpose: { kind: 'attack', action: 'melee' }, isCounter: false }
  const meleeSubRoll = subRollContext('melee')

  it('is a melee attack to the SAI reference, rolled by one die for itself', () => {
    expect(meleeSubRoll).toEqual({ purpose: { kind: 'attack', action: 'melee' }, isCounter: false, isSubRoll: true })
  })

  it("keeps an SAI's results and its reroll: Counter's melee, Rend's melee and second throw", () => {
    const face = (sai: string) => ({ count: 4, icon: 'SAI', sai }) as const
    expect(saiEffects(face('Counter'), meleeSubRoll, RULES)).toEqual({ results: { melee: 4 }, effects: [], reroll: false })
    expect(saiEffects(face('Rend'), meleeSubRoll, RULES)).toEqual({ results: { melee: 4 }, effects: [], reroll: true })
  })

  it("drops every effect, Smite's unsavable damage and a targeting face's victims alike", () => {
    const face = (sai: string) => ({ count: 4, icon: 'SAI', sai }) as const
    // The same faces in an army's melee attack, so the rule is what removes them.
    expect(saiEffects(face('Smite'), meleeAttack, RULES).effects).toEqual([{ kind: 'unsavable', damage: 4 }])
    expect(saiEffects(face('Net'), meleeAttack, RULES).effects).toHaveLength(1)
    expect(saiEffects(face('Charge'), meleeAttack, RULES).effects).toEqual([{ kind: 'charge' }])

    expect(saiEffects(face('Smite'), meleeSubRoll, RULES)).toEqual({ results: {}, effects: [], reroll: false })
    expect(saiEffects(face('Net'), meleeSubRoll, RULES).effects).toEqual([])
    expect(saiEffects(face('Charge'), meleeSubRoll, RULES).effects).toEqual([])
  })

  it('drops them for every SAI the engine resolves, and keeps every reroll', () => {
    // A sweep over the whole vocabulary, so an SAI built later -- Stone, Charm and Web
    // themselves -- is held to the rule the day its handler lands. Results are each
    // handler's own business: Wild Growth and Regenerate already give saves on any
    // sub-roll (`noSideDecision`), which a melee roll then does not count.
    for (const name of [...LIVE_SAIS, ...TARGETING_SAIS]) {
      const face = { count: 4, icon: 'SAI', sai: name } as const
      const sub = saiEffects(face, meleeSubRoll, RULES)
      expect(sub.effects, name).toEqual([])
      expect(sub.reroll, name).toBe(saiEffects(face, meleeAttack, RULES).reroll)
    }
  })

  it('leaves a save sub-roll alone: its effects are still for the caller to refuse', () => {
    const face = { count: 4, icon: 'SAI', sai: 'Counter' } as const
    const save: RollContext = { purpose: { kind: 'save', against: 'melee' }, isCounter: false, isSubRoll: true }
    expect(saiEffects(face, save, RULES).effects).toEqual([{ kind: 'riposte', damage: 4 }])
  })

  it('resolves a Smite face to nothing on the die, where an attack roll would strike', () => {
    const die: RawDie = { unitId: 'p1:0', typeId: FIRESHADOW, faceIndex: faceOf(FIRESHADOW, 'SAI:Smite') }
    const spec = { kinds: ['melee'] as const, modifiers: [] }
    const sub = resolveFaces([die], { ...spec, context: meleeSubRoll }, RULES)
    expect(sub.effects).toEqual([])
    expect(sub.totals.melee).toBe(0)
    expect(sub.dice[0]?.effects).toBeUndefined()
    expect(resolveFaces([die], { ...spec, context: meleeAttack }, RULES).effects).toHaveLength(1)
  })

  it('rolls through rollUnits with nothing for the caller to refuse', () => {
    const state = board([FIRESHADOW], [OAK], { rng: rngShowing([FIRESHADOW], [faceOf(FIRESHADOW, 'SAI:Smite')]) })
    const unit = state.units['p1:0']!
    const [[sub]] = rollUnits([{ unit, rollable: true, modifiers: [] }], 'melee', meleeSubRoll, state.rng, RULES)
    const roll = sub?.roll
    if (roll === null || roll === undefined) throw new Error('the Fireshadow did not roll')
    expect(roll.dice.map((d) => d.face)).toEqual([{ count: 4, icon: 'SAI', sai: 'Smite' }])
    expect(() => expectNoEffects(roll, 'a melee sub-roll')).not.toThrow()
  })
})

// --- 2. the save-roll bench ------------------------------------------------------------

describe('the bench on the save roll', () => {
  /** p1's Watcher hits for 3 into three Oaks with p2:1 benched; the two others save 8. */
  const benchedAttack = (): GameState =>
    board([WATCHER], [OAK, OAK, OAK, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
      rng: rngShowing([WATCHER, OAK, OAK], [faceOf(WATCHER, 'MELEE'), OAK_SAVE, OAK_SAVE]),
      turn: {
        marchStep: 'resolve_attack',
        marchingArmy: 'frontier',
        armiesMarched: ['frontier'],
        combat: { action: 'melee', targetSlot: 'frontier', damage: 0, benched: ['p2:1'] },
      },
    })

  it('leaves the benched dice out of every army roll, and so out of the estimate of one', () => {
    const state = benchedAttack()
    expect(armyRoll(state, 'p2', 'frontier', 'save').units.map((u) => u.id)).toEqual(['p2:0', 'p2:2'])
    expect(expectedArmy(state, 'p2', 'frontier', 'save').total).toBe(
      expectedArmy(board([WATCHER], [OAK, OAK]), 'p2', 'frontier', 'save').total,
    )
    // A bench is a list of units, so it can only ever leave out its own player's dice.
    expect(armyRoll(state, 'p1', 'frontier', 'melee').units.map((u) => u.id)).toEqual(['p1:0'])
  })

  it('sits out the save roll of the half it was set in, and not the counter-attack after it', () => {
    const offered = advance(benchedAttack())
    const attack = entries(offered, 'combat_resolved')[0]
    expect(attack?.saveDice?.map((d) => d.unitId)).toEqual(['p2:0', 'p2:2'])
    // `finishExchange` rebuilds the combat field by field, so the bench ends with its half.
    expect(offered.turn.combat?.benched).toBeUndefined()
    expect(offered.pending).toMatchObject({ kind: 'choose_counter_attack', player: 'p2' })

    const countered = advance(reduce(offered, { kind: 'choose_counter_attack', counter: true }))
    const counter = entries(countered, 'combat_resolved').find((e) => e.isCounter)
    expect(counter?.attackDice.slice(0, 3).map((d) => d.unitId)).toEqual(['p2:0', 'p2:1', 'p2:2'])
    expect(validateState(countered)).toEqual([])
  })
})

// --- 3. the hold fate ------------------------------------------------------------------

describe('the hold fate', () => {
  it('is named by the SAI that holds: Net nets, and a name with no word is held', () => {
    expect(heldWord('Net')).toBe('netted')
    expect(heldWord('Nobody')).toBe('held')
  })

  it('has a word for every SAI the engine resolves that holds', () => {
    const attacks: readonly RollPurpose[] = [
      { kind: 'attack', action: 'melee' },
      { kind: 'attack', action: 'missile' },
      { kind: 'attack', action: 'magic' },
    ]
    const holders = new Set<string>()
    for (const name of [...LIVE_SAIS, ...TARGETING_SAIS]) {
      for (const purpose of attacks) {
        const { effects } = saiEffects({ count: 4, icon: 'SAI', sai: name }, { purpose, isCounter: false }, RULES)
        if (effects.some((e) => e.kind === 'target_enemy' && e.fate === 'asleep')) holders.add(name)
      }
    }
    expect([...holders]).toContain('Net')
    for (const name of holders) expect(heldWord(name), name).not.toBe('held')
  })

  /** A missile at p2's Reserve Army, paused with one targeting task waiting on the queue. */
  const towerShotWith = (fate: 'asleep' | 'kill'): GameState => {
    const combat: CombatState = {
      action: 'missile',
      targetSlot: 'reserve',
      damage: 0,
      attack: {
        dice: [{ unitId: 'p1:0', typeId: WATCHER, faceIndex: faceOf(WATCHER, 'MISSILE') }],
        targets: [{ kind: 'enemy', sai: 'Web', health: 4, escape: 'maneuver', fate }],
      },
    }
    return board([WATCHER], [{ typeId: OAK, at: { kind: 'reserve' } }, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
      turn: { marchStep: 'sai_target_attack', marchingArmy: 'frontier', armiesMarched: ['frontier'], combat },
    })
  }

  it("drops on a Reserve Army by the fate, not the name, so Web's drop is not forgotten", () => {
    // A task named Web that holds is dropped where Net's is; the same task that kills is
    // asked, which is what says the drop read the fate.
    expect(advance(towerShotWith('asleep')).pending?.kind).not.toBe('sai_target')
    expect(advance(towerShotWith('kill')).pending).toMatchObject({ kind: 'sai_target', sai: 'Web' })
  })
})

// --- 4. one targeting restriction ------------------------------------------------------

describe('shielded', () => {
  it("refuses an opponent's missile and spell at an Illusioned army, and nobody's own", () => {
    const state = board([WATCHER], [OAK], { effects: [illusion('p2', 'frontier')] })
    expect(shielded(state, 'p1', 'p2', 'frontier', 'missile')).toBe(true)
    expect(shielded(state, 'p1', 'p2', 'frontier', 'spell')).toBe(true)
    expect(shielded(state, 'p1', 'p2', 'frontier', 'death_spell')).toBe(true)
    expect(shielded(state, 'p2', 'p2', 'frontier', 'spell')).toBe(false)
    // At a place: the army at another terrain, or the other player's here, is not shielded.
    expect(shielded(state, 'p1', 'p2', 'p2_home', 'missile')).toBe(false)
    expect(shielded(state, 'p2', 'p1', 'frontier', 'missile')).toBe(false)
  })

  it("is the Temple's death filter too, and only against death magic", () => {
    const base = board([WATCHER], [OAK])
    const state: GameState = {
      ...base,
      terrains: { ...base.terrains, frontier: { slot: 'frontier', dieId: 'highland_temple', face: 8, capturedBy: 'p2' } },
    }
    expect(shielded(state, 'p1', 'p2', 'frontier', 'death_spell')).toBe(true)
    expect(shielded(state, 'p1', 'p2', 'frontier', 'spell')).toBe(false)
    expect(shielded(state, 'p1', 'p2', 'frontier', 'missile')).toBe(false)
  })
})

describe('an Illusion at each reader', () => {
  /** p1 at the Frontier, p2 at the Frontier and at home. */
  const twoArmies = (effects: readonly Effect[] = []): GameState =>
    board([WATCHER], [OAK, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], { effects })

  it('takes the army out of the missile targets', () => {
    expect(missileTargets(twoArmies(), 'p1', 'frontier')).toEqual(['frontier', 'p2_home'])
    expect(missileTargets(twoArmies([illusion('p2', 'frontier')]), 'p1', 'frontier')).toEqual(['p2_home'])
    // The caster's own Illusion shields nothing from their own missiles.
    expect(missileTargets(twoArmies([illusion('p1', 'frontier')]), 'p1', 'frontier')).toEqual(['frontier', 'p2_home'])
  })

  it("takes a Reserve Army out of a Tower's missile targets", () => {
    const tower = (effects: readonly Effect[]): GameState => {
      const base = board([WATCHER], [OAK, { typeId: OAK, at: { kind: 'reserve' } }], { effects })
      return {
        ...base,
        terrains: { ...base.terrains, frontier: { slot: 'frontier', dieId: 'highland_tower', face: 8, capturedBy: 'p1' } },
      }
    }
    expect(missileTargets(tower([]), 'p1', 'frontier')).toEqual(['frontier', 'reserve'])
    expect(missileTargets(tower([illusion('p2', 'reserve')]), 'p1', 'frontier')).toEqual(['frontier'])
  })

  it('takes the army, and every die in it, out of the spell targets', () => {
    const state = twoArmies([illusion('p2', 'frontier')])
    const armies = (id: string) =>
      spellTargets(state, 'p1', spell(id)).map((o) => (o.target.kind === 'army' ? o.target.army : null))
    expect(armies('hailstorm')).toEqual(['p2_home'])
    expect(armies('palsy')).toEqual(['p2_home'])
    const units = (id: string) =>
      spellTargets(state, 'p1', spell(id)).map((o) => (o.target.kind === 'units' ? o.target.unitIds[0] : null))
    expect(units('lightning_strike')).toEqual(['p2:1'])
    expect(units('finger_of_death')).toEqual(['p2:1'])
  })

  it("leaves the caster's own spells and every terrain spell alone", () => {
    const state = board([WATCHER], [OAK, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
      effects: [illusion('p1', 'frontier'), illusion('p2', 'frontier')],
    })
    const own = spellTargets(state, 'p1', spell('stone_skin')).map((o) => (o.target.kind === 'army' ? o.target.army : null))
    expect(own).toEqual(['frontier'])
    expect(spellTargets(state, 'p1', spell('ash_storm'))).toHaveLength(3)
    // Mirage reaches either side's dice: p1's own, shielded or not, and p2's at home.
    const mirage = spellTargets(state, 'p1', spell('mirage')).map((o) => (o.target.kind === 'units' ? o.target.unitIds[0] : null))
    expect(mirage).toEqual(['p1:0', 'p2:1'])
  })

  it('refuses a Defensive Volley at an Illusioned marching army, and not one by an Illusioned defender', () => {
    // A Coastland has air, so p2's Coral Elves at the Frontier may volley.
    const volley = (effects: readonly Effect[]): readonly string[] =>
      volleyers(board([WATCHER], [BOWMAN], { dieId: 'coastland_tower', effects }), 'p2', 'frontier', 'frontier').map(
        (u) => u.id,
      )
    expect(volley([])).toEqual(['p2:0'])
    expect(volley([illusion('p1', 'frontier')])).toEqual([])
    expect(volley([illusion('p2', 'frontier')])).toEqual(['p2:0'])
  })
})

// --- 5. "counts as" between any two types ------------------------------------------------

describe('a "counts as" between magic and missile', () => {
  it('names the ability that grants maneuver as saves', () => {
    expect(maneuverAsSaves(['lava_elves'], 'Volcanic Adaptation').source).toBe('Volcanic Adaptation')
    expect(maneuverAsSaves(['coral_elves'], 'Coastal Dodge').source).toBe('Coastal Dodge')
  })

  it('moves magic into a melee roll, through the one resolver', () => {
    // No row in the game names magic yet: Necromantic Wave (8f) is the first. This is the
    // widening working end to end, a melee roll counting a magic face's icons.
    const row: Modifier = {
      kind: 'counts_as',
      from: 'magic',
      resultType: 'melee',
      counter: 'either',
      species: ['firewalkers'],
      source: 'a test',
    }
    const context: RollContext = { purpose: { kind: 'attack', action: 'melee' }, isCounter: false }
    expect(conversionsIn(['melee'], context, [row]).map((c) => [c.from, c.to])).toEqual([['magic', 'melee']])
    const sunflare = UNIT_TYPES.find((t) => t.id === 'firewalkers.sunflare')!
    const magic = sunflare.faces.findIndex((f) => f.icon === 'MAGIC')
    const count = sunflare.faces[magic]!.count
    const die: RawDie = { unitId: 'p1:0', typeId: sunflare.id, faceIndex: magic }
    expect(resolveFaces([die], { kinds: ['melee'], modifiers: [row], context }, RULES).totals.melee).toBe(count)
    expect(resolveFaces([die], { kinds: ['melee'], modifiers: [], context }, RULES).totals.melee).toBe(0)
  })
})
