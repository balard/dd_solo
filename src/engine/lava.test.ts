/**
 * The Lava Elves (v2 Phase 8), and the seams their rules stand on.
 *
 * 8b built the machinery before anything used it, so its tests drive each piece
 * directly: the melee sub-roll Web and Charm will roll, the save-roll bench Charm will
 * fill, the hold fate Web will share with Net, the one targeting restriction Illusion
 * will write, and the "counts as" types Necromantic Wave and Volcanic Adaptation need.
 * 8c's three SAIs follow: Stone, Web and Cloak; then 8d's Charm and Illusion.
 *
 * Boards are hand-built, because the Lava Elves are not playable until 8e and
 * `setupGame` would refuse them.
 */
import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, dragonFaceIcon, unitType } from '../data/load'
import { spell } from '../data/spells'
import type { DragonFaceNumber } from '../data/types'
import { expectedArmy } from '../ai/estimate'

import { missileTargets, volleyers } from './combat'
import { armyRoll, isAsleep, shielded, spellSaveSources, type Effect } from './effects'
import { spellTargets } from './magic'
import { maneuverAsSaves, type Modifier } from './pipeline'
import { advance, reduce } from './reduce'
import { rollDice, type RngState } from './rng'
import { conversionsIn, expectNoEffects, resolveFaces, rollUnits, subRollContext, type RawDie } from './roll'
import {
  LIVE_SAIS,
  TARGETING_SAIS,
  heldWord,
  resolvesSai,
  saiEffects,
  type RollContext,
  type RollPurpose,
} from './sai'
import { castSpell } from './spells'
import {
  SAI_RULES,
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

// --- 8c: Stone, Web, Cloak --------------------------------------------------------------

const BEHOLDER = 'lava_elves.beholder'
const DRIDER = 'lava_elves.drider'
const LURKER = 'lava_elves.lurker_in_the_deep'
/** Oak's first melee face, `2 MELEE`. */
const OAK_MELEE = 1

const face = (sai: string, count = 4) => ({ count, icon: 'SAI', sai }) as const
const ctx = (purpose: RollPurpose, isSubRoll = false): RollContext =>
  isSubRoll ? { purpose, isCounter: false, isSubRoll: true } : { purpose, isCounter: false }
const MELEE: RollPurpose = { kind: 'attack', action: 'melee' }
const MISSILE: RollPurpose = { kind: 'attack', action: 'missile' }
const MAGIC: RollPurpose = { kind: 'attack', action: 'magic' }
const DRAGON: RollPurpose = { kind: 'dragon_attack' }
const saveVs = (against: 'melee' | 'missile' | null): RollPurpose => ({ kind: 'save', against })

/** p1 attacks p2's army at the Frontier, about to roll; p2 keeps an Oak at home. */
const attackAt = (
  action: 'melee' | 'missile' | 'magic',
  p1: readonly (string | Die)[],
  p2: readonly (string | Die)[],
  rng: RngState,
): GameState =>
  board(p1, [...p2, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
    rng,
    turn: {
      marchStep: 'resolve_attack',
      marchingArmy: 'frontier',
      armiesMarched: ['frontier'],
      combat: { action, targetSlot: 'frontier', damage: 0 },
    },
  })

/** The same attack aimed at p2's Reserve Army instead: a Tower's only missile there. */
const atReserves = (state: GameState, typeIds: readonly string[]): GameState => {
  const units = { ...state.units }
  typeIds.forEach((typeId, i) => {
    units[`p2:r${i}`] = { id: `p2:r${i}`, typeId, owner: 'p2', location: { kind: 'reserve' } }
  })
  return { ...state, units, turn: { ...state.turn, combat: { action: 'missile', targetSlot: 'reserve', damage: 0 } } }
}

describe('Stone', () => {
  it('is unsavable damage in a melee or a missile attack, and missile against a dragon', () => {
    for (const purpose of [MELEE, MISSILE]) {
      expect(saiEffects(face('Stone'), ctx(purpose), RULES)).toEqual({
        results: {},
        effects: [{ kind: 'unsavable', damage: 4 }],
        reroll: false,
      })
    }
    expect(saiEffects(face('Stone'), ctx(DRAGON), RULES).results).toEqual({ missile: 4 })
    for (const purpose of [MAGIC, saveVs('melee'), { kind: 'maneuver' } as const]) {
      expect(saiEffects(face('Stone'), ctx(purpose), RULES)).toEqual({ results: {}, effects: [], reroll: false })
    }
  })

  it("is on the results rung with Smite, whose handler it is", () => {
    expect(resolvesSai('Stone', SAI_RULES)).toBe(true)
    expect(LIVE_SAIS).toContain('Stone')
  })

  it('kills through a missile exchange, where nothing unsavable reached before', () => {
    const rng = rngShowing([BEHOLDER], [faceOf(BEHOLDER, 'SAI:Stone')])
    const done = advance(attackAt('missile', [BEHOLDER], [OAK, OAK, OAK], rng))
    // A Stone-only attack rolls no missile, so the defenders roll no saves -- and still lose 4.
    expect(entries(done, 'combat_resolved')[0]).toMatchObject({
      action: 'missile',
      attackTotal: 0,
      saveTotal: null,
      unsavable: 4,
      damage: 4,
    })
    expect(done.pending).toMatchObject({ kind: 'assign_damage', player: 'p2' })
    expect(validateState(done)).toEqual([])
  })

  it("reaches a Reserve Army through a Tower's missile", () => {
    const rng = rngShowing([BEHOLDER], [faceOf(BEHOLDER, 'SAI:Stone')])
    const asked = advance(atReserves(attackAt('missile', [BEHOLDER], [], rng), [OAK, OAK]))
    expect(entries(asked, 'combat_resolved')[0]).toMatchObject({ defenderSlot: 'reserve', unsavable: 4, damage: 4 })
    const done = advance(reduce(asked, { kind: 'assign_damage', unitIds: ['p2:r0', 'p2:r1'] }))
    expect(done.units['p2:r0']?.location).toEqual({ kind: 'dua' })
    expect(done.units['p2:r1']?.location).toEqual({ kind: 'dua' })
    expect(validateState(done)).toEqual([])
  })

  it("is priced as Smite's line in the estimate: unsavable, and never a result", () => {
    // Every face of the Beholder resolves since 8d, so on the full rung: Flame, Charm and
    // Confuse are `targeted`, never `unsavable`, and Illusion is nothing at all.
    const state = board([BEHOLDER], [OAK])
    const melee = expectedArmy(state, 'p1', 'frontier', 'melee')
    const missile = expectedArmy(state, 'p1', 'frontier', 'missile')
    // One Stone face in ten, four damage: 0.4 unsavable whichever action carries it.
    expect(melee.unsavable).toBeCloseTo(0.4)
    expect(missile.unsavable).toBeCloseTo(0.4)
  })
})

describe('Web', () => {
  it('targets in melee and missile alike, escapes on melee, and gives nothing in a sub-roll', () => {
    for (const purpose of [MELEE, MISSILE]) {
      expect(saiEffects(face('Web'), ctx(purpose), RULES).effects).toEqual([
        { kind: 'target_enemy', health: 4, escape: 'melee', fate: 'asleep' },
      ])
    }
    // Unlike Net, which saves when its own die is targeted.
    expect(saiEffects(face('Web'), ctx(saveVs(null), true), RULES)).toEqual({ results: {}, effects: [], reroll: false })
    expect(saiEffects(face('Net'), ctx(saveVs(null), true), RULES).results).toEqual({ save: 4 })
  })

  const webbing = (targets: readonly string[], targetFaces: readonly number[]) =>
    advance(
      attackAt(
        'melee',
        [DRIDER, WATCHER],
        targets,
        rngShowing(
          [DRIDER, WATCHER, ...targets.slice(0, targetFaces.length)],
          [faceOf(DRIDER, 'SAI:Web'), faceOf(WATCHER, 'MELEE'), ...targetFaces],
        ),
      ),
    )

  it("holds what fails its melee roll with Sleep's status under Web's name, and lets a melee go", () => {
    const asked = webbing([OAK, OAK, OAK], [OAK_SAVE, OAK_MELEE])
    expect(asked.pending).toMatchObject({ kind: 'sai_target', sai: 'Web' })
    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })

    expect(entries(done, 'sai_sub_roll')).toMatchObject([
      { source: 'Web', test: 'melee', fate: 'asleep', escaped: ['p2:1'] },
    ])
    expect(isAsleep(done, 'p2:0')).toBe(true)
    expect(isAsleep(done, 'p2:1')).toBe(false)
    expect(done.effects).toEqual([
      { source: 'Web', target: { kind: 'unit', unitId: 'p2:0' }, modifiers: [], asleep: true, expiresAtStartOfTurnOf: 'p1' },
    ])
    expect(heldWord('Web')).toBe('webbed')
    // Webbed, not killed, and out of the save roll that follows.
    expect(done.units['p2:0']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    const saved = entries(done, 'combat_resolved')[0]?.saveDice ?? []
    expect(saved.map((d) => d.unitId)).toEqual(['p2:1', 'p2:2'])
    expect(validateState(done)).toEqual([])
  })

  it("rolls a target's SAI for its results only: a Smite strikes nobody, a Counter escapes", () => {
    const fireshadow = (sai: string) => {
      const asked = webbing([FIRESHADOW], [faceOf(FIRESHADOW, `SAI:${sai}`)])
      return reduce(asked, { kind: 'sai_target', unitIds: ['p2:0'] })
    }
    const smote = fireshadow('Smite')
    expect(entries(smote, 'sai_sub_roll')).toMatchObject([{ source: 'Web', test: 'melee', escaped: [] }])
    expect(isAsleep(smote, 'p2:0')).toBe(true)
    // The Smite was dropped by 8b's rule: nothing came back at p1's army.
    expect(entries(smote, 'units_killed').filter((e) => e.player === 'p1')).toEqual([])
    expect(entries(fireshadow('Counter'), 'sai_sub_roll')).toMatchObject([{ escaped: ['p2:0'] }])
  })

  it("does nothing in a missile attack on a Reserve Army, a Tower's only missile there", () => {
    const rng = rngShowing([DRIDER], [faceOf(DRIDER, 'SAI:Web')])
    const after = advance(atReserves(attackAt('missile', [DRIDER], [], rng), [OAK]))
    expect(after.pending?.kind).not.toBe('sai_target')
    expect(entries(after, 'sai_sub_roll')).toEqual([])
  })

  it('asks at a terrain in a missile attack', () => {
    const rng = rngShowing([DRIDER], [faceOf(DRIDER, 'SAI:Web')])
    expect(advance(attackAt('missile', [DRIDER], [OAK], rng)).pending).toMatchObject({ kind: 'sai_target', sai: 'Web' })
  })
})

describe('Cloak', () => {
  const cloakOn = (player: PlayerId, army: TerrainSlot): Effect => ({
    source: 'Cloak',
    target: { kind: 'army', player, army },
    modifiers: [{ kind: 'add', resultType: 'save', amount: 4 }],
    expiresAtStartOfTurnOf: player,
  })

  it('saves X and lasts in a save roll or a dragon attack', () => {
    const lasting = { results: { save: 4 }, effects: [{ kind: 'cloak', saves: 4 }], reroll: false }
    for (const purpose of [saveVs('melee'), saveVs('missile'), saveVs(null), DRAGON]) {
      expect(saiEffects(face('Cloak'), ctx(purpose), RULES)).toEqual(lasting)
    }
  })

  it('is X magic in a magic action, and nothing in any other attack or a maneuver', () => {
    expect(saiEffects(face('Cloak'), ctx(MAGIC), RULES)).toEqual({ results: { magic: 4 }, effects: [], reroll: false })
    for (const purpose of [MELEE, MISSILE, { kind: 'maneuver' } as const]) {
      expect(saiEffects(face('Cloak'), ctx(purpose), RULES)).toEqual({ results: {}, effects: [], reroll: false })
    }
  })

  it('is X of whatever an individual-targeting roll counts, and no effect', () => {
    expect(saiEffects(face('Cloak'), ctx(saveVs(null), true), RULES)).toEqual({ results: { save: 4 }, effects: [], reroll: false })
    expect(saiEffects(face('Cloak'), ctx({ kind: 'maneuver' }, true), RULES).results).toEqual({ maneuver: 4 })
    expect(saiEffects(face('Cloak'), subRollContext('melee'), RULES).results).toEqual({ melee: 4 })
  })

  /** p1's Watcher hits for 3; p2's Lurkers show these faces and its Oak a save. */
  const cloaked = (lurkers: number) =>
    advance(
      attackAt(
        'melee',
        [WATCHER],
        [...Array.from({ length: lurkers }, () => LURKER), OAK],
        rngShowing(
          [WATCHER, ...Array.from({ length: lurkers }, () => LURKER), OAK],
          [faceOf(WATCHER, 'MELEE'), ...Array.from({ length: lurkers }, () => faceOf(LURKER, 'SAI:Cloak')), OAK_SAVE],
        ),
      ),
    )

  it('counts its X once in the save roll it is rolled in, and adds X to every save roll after', () => {
    const done = cloaked(1)
    // Cloak's 4 and the Oak's 4: eight, not twelve -- the effect is written after the roll.
    expect(entries(done, 'combat_resolved')[0]?.saveTotal).toBe(8)
    expect(entries(done, 'effect_cast')).toEqual([
      { kind: 'effect_cast', player: 'p2', source: 'Cloak', target: 'p2', slot: 'frontier' },
    ])
    expect(done.effects).toEqual([cloakOn('p2', 'frontier')])
    expect(armyRoll(done, 'p2', 'frontier', 'save').modifiers).toContainEqual({
      kind: 'add',
      resultType: 'save',
      amount: 4,
      source: 'Cloak',
    })
    // "Non-magical": no spell save, so it never reduces a riposte, a Charge or a curse.
    expect(spellSaveSources(done, 'p2', 'frontier')).toEqual([])
    expect(validateState(done)).toEqual([])
  })

  it('stacks: two Cloaks are two effects', () => {
    const done = cloaked(2)
    expect(entries(done, 'combat_resolved')[0]?.saveTotal).toBe(12)
    expect(done.effects).toEqual([cloakOn('p2', 'frontier'), cloakOn('p2', 'frontier')])
  })

  it("is written by a spell's save roll too", () => {
    const state = board([WATCHER], [LURKER, OAK], {
      rng: rngShowing([LURKER, OAK], [faceOf(LURKER, 'SAI:Cloak'), OAK_SAVE]),
    })
    const outcome = castSpell(state, spell('hailstorm'), {
      caster: 'p1',
      army: 'frontier',
      element: 'air',
      count: 3,
      target: { kind: 'army', player: 'p2', army: 'frontier' },
    })
    expect(entries(outcome.state, 'spell_saves')).toMatchObject([{ source: 'Hailstorm', saves: 8 }])
    expect(outcome.state.effects).toEqual([cloakOn('p2', 'frontier')])
  })

  it("is written by Wall of Thorns' roll, which stands in for a save roll and counts melee", () => {
    const ward: Effect = {
      source: 'Wall of Thorns',
      target: { kind: 'terrain', slot: 'frontier', scope: 'maneuverers' },
      modifiers: [],
      thorns: 6,
      expiresAtStartOfTurnOf: 'p2',
    }
    const state = board([LURKER, OAK], [{ typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
      rng: rngShowing([LURKER, OAK], [faceOf(LURKER, 'SAI:Cloak'), OAK_MELEE]),
      effects: [ward],
      turn: { marchStep: 'thorns_damage', marchingArmy: 'frontier', armiesMarched: ['frontier'] },
    })
    const done = advance(state)
    // The Oak's 2 melee is all the roll counts; the Cloak is only the lasting +4 save.
    expect(entries(done, 'thorns')).toMatchObject([{ melee: 2, damage: 4 }])
    expect(done.effects).toContainEqual(cloakOn('p1', 'frontier'))
  })

  it('is written by the dragon roll, which counts its saves once', () => {
    const claw = (() => {
      for (let n = 1; n <= 12; n++) if (dragonFaceIcon('fire_drake', n as DragonFaceNumber) === 'CLAW') return n - 1
      throw new Error('a fire drake has no claw')
    })()
    const counts = [12, 10, 6]
    const faces = [claw, faceOf(LURKER, 'SAI:Cloak'), OAK_SAVE]
    let rng: RngState | null = null
    for (let counter = 0; counter < 400_000 && rng === null; counter += 1) {
      const [indices] = rollDice({ seed: 1, counter }, counts)
      if (faces.every((f, i) => indices[i] === f)) rng = { seed: 1, counter }
    }
    if (rng === null) throw new Error('no counter shows a claw, a Cloak and a save')
    const base = board([LURKER, OAK], [{ typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
      rng,
      turn: { phase: 'dragon_attack' },
    })
    const done = advance({
      ...base,
      dragons: { d: { id: 'd', dieId: 'fire_drake', owner: 'p2', location: { kind: 'terrain', slot: 'frontier' } } },
    })
    expect(entries(done, 'dragon_roll')).toMatchObject([{ player: 'p1', totals: { save: 8 } }])
    expect(done.effects).toContainEqual(cloakOn('p1', 'frontier'))
    expect(validateState(done)).toEqual([])
  })

  it("is priced as its saves in the estimate of a save roll", () => {
    // Lurker in the Deep on a save roll: its ID (4), Counter, Volley, Cloak and Fly are
    // four saves each, and five blanks -- 20 / 10 = 2. Without Cloak's line it is 1.6.
    expect(expectedArmy(board([WATCHER], [LURKER]), 'p2', 'frontier', 'save').total).toBeCloseTo(2)
  })
})

// --- 8d: Charm, Illusion --------------------------------------------------------------

const RAKSHASA = 'lava_elves.rakshasa'
const BEHEMOTH = 'dwarves.behemoth'
/** Watcher: `3 MELEE` at face 1, `2 SAVE` at face 2. */
const WATCHER_SAVE = 2

describe('Charm', () => {
  it('targets in a melee attack, with no escape and no death, and in nothing else', () => {
    expect(saiEffects(face('Charm'), ctx(MELEE), RULES).effects).toEqual([
      { kind: 'target_enemy', health: 4, escape: 'none', fate: 'charm' },
    ])
    for (const purpose of [MISSILE, MAGIC, saveVs('melee'), DRAGON]) {
      expect(saiEffects(face('Charm'), ctx(purpose), RULES)).toEqual({ results: {}, effects: [], reroll: false })
    }
    // 8b's rule: a charmed Beholder's own Charm charms nobody.
    expect(saiEffects(face('Charm'), subRollContext('melee'), RULES).effects).toEqual([])
  })

  /** p1's dice show these faces; then the charmed dice and the save roll, in that order. */
  const charming = (
    p1: readonly string[],
    p1Faces: readonly number[],
    p2: readonly (string | Die)[],
    rolled: readonly string[],
    rolledFaces: readonly number[],
    extra: Partial<GameState> = {},
  ): GameState =>
    advance({
      ...attackAt('melee', p1, p2, rngShowing([...p1, ...rolled], [...p1Faces, ...rolledFaces])),
      ...extra,
    })

  it('rolls the targets for the attacker, benches them for the save roll, and adds their melee', () => {
    // The Beholder's Charm takes two Oaks, which roll 2 melee each for p1; the third Oak
    // saves alone, and shows melee, so it saves nothing.
    const asked = charming([BEHOLDER], [faceOf(BEHOLDER, 'SAI:Charm')], [OAK, OAK, OAK], [OAK, OAK, OAK], [
      OAK_MELEE,
      OAK_MELEE,
      OAK_MELEE,
    ])
    expect(asked.pending).toMatchObject({ kind: 'sai_target', sai: 'Charm', limit: { kind: 'health', budget: 4 } })
    // p. 32's forced maximum, as for every SAI aimed at the opponent.
    expect(() => reduce(asked, { kind: 'sai_target', unitIds: ['p2:0'] })).toThrow()

    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:1', 'p2:0'] })
    expect(entries(done, 'sai_sub_roll')).toMatchObject([
      { player: 'p2', source: 'Charm', test: 'melee', fate: 'charm', given: 4, escaped: [] },
    ])
    expect(entries(done, 'sai_sub_roll')[0]?.dice.map((d) => d.unitId)).toEqual(['p2:0', 'p2:1'])
    const resolved = entries(done, 'combat_resolved')[0]
    expect(resolved).toMatchObject({ attackTotal: 4, saveTotal: 0, damage: 4 })
    expect(resolved?.saveDice?.map((d) => d.unitId)).toEqual(['p2:2'])
    // "9 on the dice + 5 Charm = 14", here 0 + 4.
    expect(resolved?.attackMath?.steps).toContainEqual({ source: 'Charm', delta: 4 })
    // "Those units may take damage from the melee attack as normal."
    expect(done.pending).toMatchObject({ kind: 'assign_damage', player: 'p2' })
    expect(done.turn.combat?.benched).toBeUndefined()
    expect(validateState(done)).toEqual([])
  })

  it('sits out only the save roll: the charmed dice counter-attack', () => {
    // The third Oak saves 4 against the 4: nothing dies, and the counter is offered.
    const asked = charming([BEHOLDER], [faceOf(BEHOLDER, 'SAI:Charm')], [OAK, OAK, OAK], [OAK, OAK, OAK], [
      OAK_MELEE,
      OAK_MELEE,
      OAK_SAVE,
    ])
    const offered = advance(reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] }))
    expect(offered.pending).toMatchObject({ kind: 'choose_counter_attack', player: 'p2' })
    const countered = advance(reduce(offered, { kind: 'choose_counter_attack', counter: true }))
    const counter = entries(countered, 'combat_resolved').find((e) => e.isCounter)
    expect(counter?.attackDice.slice(0, 3).map((d) => d.unitId)).toEqual(['p2:0', 'p2:1', 'p2:2'])
  })

  it("rolls each die as a unit: no army modifier of its owner's reaches it", () => {
    // Dancing Lights' six melee off p2's army would zero an army roll of these Oaks; a unit
    // roll never sees it (p. 28).
    const lights: Effect = {
      source: 'Dancing Lights',
      target: { kind: 'army', player: 'p2', army: 'frontier' },
      modifiers: [{ kind: 'subtract', resultType: 'melee', amount: 6 }],
      expiresAtStartOfTurnOf: 'p1',
    }
    const asked = charming([BEHOLDER], [faceOf(BEHOLDER, 'SAI:Charm')], [OAK, OAK, OAK], [OAK, OAK, OAK], [
      OAK_MELEE,
      OAK_MELEE,
      OAK_SAVE,
    ], { effects: [lights] })
    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })
    expect(entries(done, 'sai_sub_roll')[0]).toMatchObject({ fate: 'charm', given: 4 })
  })

  it('rolls each die with its own species ability: Flaming Shields, for the enemy', () => {
    // Highland is fire and earth, so a charmed Watcher's 2 saves are 2 melee.
    const asked = charming(
      [BEHOLDER],
      [faceOf(BEHOLDER, 'SAI:Charm')],
      [WATCHER, WATCHER, OAK],
      [WATCHER, WATCHER, OAK],
      [WATCHER_SAVE, WATCHER_SAVE, OAK_SAVE],
    )
    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })
    expect(entries(done, 'sai_sub_roll')[0]).toMatchObject({ fate: 'charm', given: 4 })
  })

  it('takes nothing from a die that cannot be rolled, and draws nothing for it', () => {
    const sleep: Effect = {
      source: 'Sleep',
      target: { kind: 'unit', unitId: 'p2:0' },
      modifiers: [],
      asleep: true,
      expiresAtStartOfTurnOf: 'p1',
    }
    const asked = charming([BEHOLDER], [faceOf(BEHOLDER, 'SAI:Charm')], [OAK, OAK, OAK], [OAK, OAK], [OAK_MELEE, OAK_SAVE], {
      effects: [sleep],
    })
    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })
    const charmed = entries(done, 'sai_sub_roll')[0]
    expect(charmed?.dice.map((d) => d.unitId)).toEqual(['p2:1'])
    expect(charmed).toMatchObject({ given: 2 })
    // Asleep and charmed both sit out: the save roll is the third Oak alone.
    expect(entries(done, 'combat_resolved')[0]?.saveDice?.map((d) => d.unitId)).toEqual(['p2:2'])
  })

  it('outlives the next task on the queue: a Flame answered after it keeps the melee', () => {
    // Two Beholders, Charm then Flame (two health-worth, killed and buried). The queue's
    // rebuild after the Flame must still carry the Charm's 4.
    const asked = charming(
      [BEHOLDER, BEHOLDER],
      [faceOf(BEHOLDER, 'SAI:Charm'), faceOf(BEHOLDER, 'SAI:Flame')],
      [OAK, OAK, OAK, OAK],
      [OAK, OAK, OAK],
      [OAK_MELEE, OAK_MELEE, OAK_SAVE],
    )
    const flamed = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })
    expect(flamed.pending).toMatchObject({ kind: 'sai_target', sai: 'Flame' })
    const done = reduce(flamed, { kind: 'sai_target', unitIds: ['p2:2'] })
    expect(entries(done, 'combat_resolved')[0]).toMatchObject({ attackTotal: 4, saveTotal: 4, damage: 0 })
  })

  it("adds the charmed dice's melee to a Charge, and keeps them out of the combination roll", () => {
    // The Behemoth charges and the Beholder charms. The charmed Oaks' 4 melee join the
    // attack; the third Oak alone makes the combination save and melee roll.
    const asked = charming(
      [BEHOLDER, BEHEMOTH],
      [faceOf(BEHOLDER, 'SAI:Charm'), faceOf(BEHEMOTH, 'SAI:Charge')],
      [OAK, OAK, OAK],
      [OAK, OAK, OAK],
      [OAK_MELEE, OAK_MELEE, OAK_SAVE],
    )
    const done = advance(reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] }))
    const resolved = entries(done, 'combat_resolved')[0]
    expect(resolved).toMatchObject({ attackTotal: 4, saveTotal: 4, damage: 0, charge: { melee: 0 } })
    expect(resolved?.saveDice?.map((d) => d.unitId)).toEqual(['p2:2'])
  })
})

describe('Confuse after a Charm', () => {
  it('picks only among the dice that rolled saves, so never a charmed or sleeping one', () => {
    const sleep: Effect = {
      source: 'Sleep',
      target: { kind: 'unit', unitId: 'p2:1' },
      modifiers: [],
      asleep: true,
      expiresAtStartOfTurnOf: 'p1',
    }
    const state = attackAt(
      'melee',
      [BEHOLDER, WATCHER],
      [OAK, OAK],
      rngShowing([BEHOLDER, WATCHER, OAK], [faceOf(BEHOLDER, 'SAI:Confuse'), faceOf(WATCHER, 'MELEE'), OAK_MELEE]),
    )
    const asked = advance({ ...state, effects: [sleep] })
    expect(asked.pending).toMatchObject({ kind: 'sai_target', sai: 'Confuse', eligible: ['p2:0'] })
    expect(() => reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })).toThrow()
  })
})

describe('Illusion', () => {
  it('shields one of your armies from any attack roll, and does nothing elsewhere', () => {
    for (const purpose of [MELEE, MISSILE, MAGIC]) {
      expect(saiEffects(face('Illusion'), ctx(purpose), RULES).effects).toEqual([{ kind: 'illusion' }])
    }
    for (const purpose of [saveVs('melee'), DRAGON, { kind: 'maneuver' } as const]) {
      expect(saiEffects(face('Illusion'), ctx(purpose), RULES)).toEqual({ results: {}, effects: [], reroll: false })
    }
    expect(saiEffects(face('Illusion'), subRollContext('melee'), RULES).effects).toEqual([])
  })

  const illusioned = (p1: readonly (string | Die)[], action: 'melee' | 'magic' = 'melee', faces = 1) =>
    advance(
      attackAt(
        action,
        p1,
        [OAK],
        rngShowing(
          Array.from({ length: faces }, () => RAKSHASA),
          Array.from({ length: faces }, () => faceOf(RAKSHASA, 'SAI:Illusion')),
        ),
      ),
    )
  const shield = (player: PlayerId, army: TerrainSlot | 'reserve'): Effect => ({
    source: 'Illusion',
    target: { kind: 'army', player, army },
    modifiers: [],
    illusion: true,
    expiresAtStartOfTurnOf: player,
  })

  it('lands without a question when there is one army to shield, and the log says so', () => {
    const done = illusioned([RAKSHASA])
    expect(entries(done, 'effect_cast')).toEqual([
      { kind: 'effect_cast', player: 'p1', source: 'Illusion', target: 'p1', slot: 'frontier' },
    ])
    expect(done.effects).toEqual([shield('p1', 'frontier')])
    // And it does what it is for: p2 may not aim a missile at it.
    expect(missileTargets(done, 'p2', 'frontier')).toEqual([])
  })

  it('asks which army when there are two', () => {
    const asked = illusioned([RAKSHASA, { typeId: OAK, at: { kind: 'reserve' } }])
    expect(asked.pending).toEqual({
      kind: 'sai_illusion',
      player: 'p1',
      sai: 'Illusion',
      options: ['frontier', 'reserve'],
      remaining: 1,
    })
    expect(() => reduce(asked, { kind: 'sai_illusion', army: 'p2_home' })).toThrow()
    const done = reduce(asked, { kind: 'sai_illusion', army: 'reserve' })
    expect(done.effects).toEqual([shield('p1', 'reserve')])
    expect(validateState(done)).toEqual([])
  })

  it('never combines: two faces are two choices, which may shield two armies', () => {
    const asked = illusioned([RAKSHASA, RAKSHASA, { typeId: OAK, at: { kind: 'terrain', slot: 'p1_home' } }], 'melee', 2)
    expect(asked.pending).toMatchObject({ kind: 'sai_illusion', remaining: 2 })
    const second = reduce(asked, { kind: 'sai_illusion', army: 'frontier' })
    expect(second.pending).toMatchObject({ kind: 'sai_illusion', remaining: 1 })
    const done = reduce(second, { kind: 'sai_illusion', army: 'p1_home' })
    expect(done.effects).toEqual([shield('p1', 'frontier'), shield('p1', 'p1_home')])
  })

  it('is rolled on a magic action too', () => {
    const done = illusioned([RAKSHASA], 'magic')
    expect(done.effects).toContainEqual(shield('p1', 'frontier'))
  })
})
