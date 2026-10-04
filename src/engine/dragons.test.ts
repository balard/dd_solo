import { describe, expect, it } from 'vitest'

import { randomAi } from '../ai/random'
import { runGame } from '../ai/run'
import { dragonFaceIcon, dragonName, unitType } from '../data/load'
import type { DragonFaceNumber, DragonIcon } from '../data/types'

import {
  BREATH_EFFECT,
  BREATH_NAME,
  DRAGON_AUTOMATIC_SAVES,
  DRAGON_HEALTH,
  dragonTargets,
  dragonTotals,
  killThreshold,
  rollDragon,
  type DragonRoll,
} from './dragons'
import { applyModifiers, ignoreIdsModifiers, doubleIdsModifier } from './pipeline'
import { passiveAi } from '../ai/passive'
import { advance, begin, reduce } from './reduce'
import { damageOptions } from './damage'
import { resolveFaces } from './roll'
import { DRAGON_ROLL_KINDS } from './sai'
import { rollOnTheTable } from './turn'
import { rngFrom } from './rng'
import { BESTIARY_FORCES, STARTER_FORCES, setupGame, type ForceSpec } from './setup'
import {
  armyAt,
  DRAGON_RULES,
  dragonsAt,
  type DragonInPlay,
  type GameState,
  type Pending,
  type TerrainSlot,
} from './types'

/** The face index carrying an icon on a given die -- so no test hardcodes a number. */
function faceShowing(dieId: string, icon: DragonIcon): DragonFaceNumber {
  for (let n = 1 as number; n <= 12; n++) {
    if (dragonFaceIcon(dieId, n as DragonFaceNumber) === icon) return n as DragonFaceNumber
  }
  throw new Error(`${dieId} has no ${icon} face`)
}

/** A bare state with the named dragons at the Frontier, for the pure functions. */
function withDragons(dieIds: Readonly<Record<string, string>>): GameState {
  const dragons: Record<string, DragonInPlay> = {}
  for (const [id, dieId] of Object.entries(dieIds)) {
    dragons[id] = {
      id,
      dieId,
      owner: id.startsWith('p1') ? 'p1' : 'p2',
      location: { kind: 'terrain', slot: 'frontier' },
    }
  }
  return { dragons } as unknown as GameState
}

const roll = (dragonId: string, dieId: string, icon: DragonIcon): DragonRoll => ({
  dragonId,
  faceIndex: faceShowing(dieId, icon),
})

describe('dragon icons', () => {
  const state = withDragons({ d: 'fire_drake' })
  const totals = (icon: DragonIcon, againstDragon = false) =>
    dragonTotals(state, [roll('d', 'fire_drake', icon)], againstDragon)

  it('inflicts what the reference says, icon by icon', () => {
    expect(totals('JAWS').damage).toBe(12)
    expect(totals('CLAW').damage).toBe(6)
    expect(totals('WING').damage).toBe(5)
    expect(totals('TAIL').damage).toBe(3)
    expect(totals('BELLY').damage).toBe(0)
  })

  it('makes breath five points against a dragon and five health-worth against an army', () => {
    expect(totals('BREATH', true).damage).toBe(5)
    expect(totals('BREATH', true).breaths).toBe(0)
    expect(totals('BREATH', false).damage).toBe(0)
    expect(totals('BREATH', false).breaths).toBe(1)
  })

  it('gives treasure to an army attack only', () => {
    const wyrm = withDragons({ d: 'fire_wyrm' })
    const against = (againstDragon: boolean) =>
      dragonTotals(wyrm, [roll('d', 'fire_wyrm', 'TREASURE')], againstDragon)
    expect(against(false).treasures).toBe(1)
    expect(against(true).treasures).toBe(0)
  })

  it('flags Belly and Wing for the steps that read them', () => {
    expect(totals('BELLY').bellyUp).toBe(true)
    expect(totals('WING').flies).toBe(true)
    expect(totals('CLAW').bellyUp).toBe(false)
    expect(totals('CLAW').flies).toBe(false)
  })

  it('sums a dragon whole roll, rerolls included', () => {
    const both = dragonTotals(
      state,
      [roll('d', 'fire_drake', 'TAIL'), { ...roll('d', 'fire_drake', 'JAWS'), reroll: true }],
      false,
    )
    expect(both.damage).toBe(15)
  })
})

describe('what it takes to kill a dragon', () => {
  it('is ten -- five health behind five automatic saves', () => {
    expect(DRAGON_HEALTH).toBe(5)
    expect(DRAGON_AUTOMATIC_SAVES).toBe(5)
    expect(killThreshold(false)).toBe(10)
  })

  it('is five once it shows its belly', () => {
    expect(killThreshold(true)).toBe(5)
  })
})

describe('rollDragon', () => {
  it('rolls once and stops on a face that does not say otherwise', () => {
    // Seeded until it lands on something that is not Tail: the point is the shape.
    for (let seed = 1; seed <= 20; seed++) {
      const [rolls] = rollDragon('d', 'fire_drake', false, rngFrom(seed))
      expect(rolls[0]?.reroll).toBeUndefined()
      for (const extra of rolls.slice(1)) expect(extra.reroll).toBe(true)
      // Every roll but the last must have been a rerolling face.
      for (const earlier of rolls.slice(0, -1)) {
        expect(dragonFaceIcon('fire_drake', earlier.faceIndex as DragonFaceNumber)).toBe('TAIL')
      }
    }
  })

  it('rerolls on breath only when the target is another dragon', () => {
    // A breath face against an army ends the roll; against a dragon it continues.
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1)
    const breathFirst = seeds.filter((seed) => {
      const [rolls] = rollDragon('d', 'fire_drake', false, rngFrom(seed))
      return (
        rolls[0] !== undefined &&
        dragonFaceIcon('fire_drake', rolls[0].faceIndex as DragonFaceNumber) === 'BREATH'
      )
    })
    expect(breathFirst.length).toBeGreaterThan(0)
    for (const seed of breathFirst) {
      expect(rollDragon('d', 'fire_drake', false, rngFrom(seed))[0]).toHaveLength(1)
      expect(
        rollDragon('d', 'fire_drake', true, rngFrom(seed))[0].length,
      ).toBeGreaterThan(1)
    }
  })

  it('consumes randomness once per face shown', () => {
    const [rolls, rng] = rollDragon('d', 'fire_drake', false, rngFrom(7))
    expect(rng.counter).toBe(rolls.length)
  })
})

describe('who a dragon attacks', () => {
  const targetsAt = (state: GameState) => dragonTargets(state, 'frontier', 'p1').settled

  it('attacks a dragon of another element rather than the army', () => {
    const state = withDragons({ p1d: 'fire_drake', p2d: 'water_drake' })
    expect(targetsAt(state).get('p1d')).toEqual({ kind: 'dragon', dragonId: 'p2d' })
    expect(targetsAt(state).get('p2d')).toEqual({ kind: 'dragon', dragonId: 'p1d' })
  })

  /** The one exclusion the five base elements can produce. */
  it('never attacks a dragon of its own element, whatever form it takes', () => {
    const state = withDragons({ p1d: 'fire_drake', p2d: 'fire_wyrm' })
    expect(targetsAt(state).get('p1d')).toEqual({ kind: 'army', player: 'p1' })
    expect(targetsAt(state).get('p2d')).toEqual({ kind: 'army', player: 'p1' })
  })

  it('attacks the marching army when it is alone', () => {
    const state = withDragons({ p1d: 'fire_drake' })
    expect(targetsAt(state).get('p1d')).toEqual({ kind: 'army', player: 'p1' })
  })

  /** "Dragons attack regardless of who owns or summoned the dragon" (p. 17). */
  it('attacks its own summoner army just the same', () => {
    const state = withDragons({ p1d: 'fire_drake' })
    expect(dragonTargets(state, 'frontier', 'p1').settled.get('p1d')).toEqual({
      kind: 'army',
      player: 'p1',
    })
  })
})

describe('the five breaths', () => {
  it('maps each element to its own effect and name', () => {
    expect(BREATH_EFFECT).toEqual({
      air: 'halve_melee',
      death: 'ignore_id',
      earth: 'halve_maneuver',
      fire: 'bury_killed',
      water: 'halve_missile',
    })
    expect(BREATH_NAME.fire).toBe('Dragon Fire')
    expect(BREATH_NAME.death).toBe('Dragon Plague')
  })

  /**
   * "Halving modifiers from elemental breath effects are not cumulative, though
   * multiple different elemental breath effects may apply at the same time" -- which
   * is pipeline step 7's one-divider-per-result-type rule, already built.
   */
  it('lets two different halvings apply and refuses two of a kind', () => {
    const share = { id: 0, normal: 8, sai: 0 }
    const air = { kind: 'divide', resultType: 'melee', by: 2 } as const
    const water = { kind: 'divide', resultType: 'missile', by: 2 } as const

    expect(applyModifiers(share, 'melee', [air, water])).toBe(4)
    expect(applyModifiers(share, 'missile', [air, water])).toBe(4)
    expect(() => applyModifiers(share, 'melee', [air, air])).toThrow(/at most one/)
  })

  /** Death: "the army ignores all of its ID results". */
  it('zeroes the ID share without eating the multiplier budget', () => {
    const share = { id: 6, normal: 2, sai: 0 }
    expect(applyModifiers(share, 'melee', [])).toBe(8)
    expect(applyModifiers(share, 'melee', ignoreIdsModifiers())).toBe(2)
    // An army holding an eighth face doubles IDs at step 9; the two must coexist,
    // and zero doubled is still zero rather than a throw.
    expect(
      applyModifiers(share, 'melee', [...ignoreIdsModifiers(), doubleIdsModifier('melee')]),
    ).toBe(2)
  })

  it('applies to every result type, since it is a fact about the army', () => {
    for (const type of ['melee', 'missile', 'magic', 'save', 'maneuver'] as const) {
      expect(applyModifiers({ id: 4, normal: 1, sai: 0 }, type, ignoreIdsModifiers())).toBe(1)
    }
  })
})

describe('the dragon setup seed', () => {
  it('puts one dragon of each player on the Frontier and nowhere else', () => {
    const state = setupGame({ seed: 11, forces: STARTER_FORCES, ruleSet: DRAGON_RULES })
    expect(dragonsAt(state, 'frontier')).toHaveLength(2)
    for (const slot of ['p1_home', 'p2_home'] as TerrainSlot[]) {
      expect(dragonsAt(state, slot)).toEqual([])
    }
  })

  /** Treefolk are water+earth, Firewalkers air+fire, so they never share one. */
  it('always sets up a duel in the starter matchup', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = setupGame({ seed, forces: STARTER_FORCES, ruleSet: DRAGON_RULES })
      for (const [, target] of dragonTargets(state, 'frontier', 'p1').settled) {
        expect(target.kind, `seed ${seed}`).toBe('dragon')
      }
    }
  })

  /** A mirror shares both elements, so the same-element rule is reachable there. */
  it('reaches the same-element case in a mirror, where both attack the army', () => {
    const mirror: ForceSpec = {
      kind: 'named',
      forces: { p1: 'treefolk_darktree', p2: 'treefolk_redwood' },
    }
    let sameElement = 0
    for (let seed = 1; seed <= 50; seed++) {
      const state = setupGame({ seed, forces: mirror, ruleSet: DRAGON_RULES })
      const targets = [...dragonTargets(state, 'frontier', 'p1').settled.values()]
      if (targets.every((t) => t.kind === 'army')) sameElement++
    }
    expect(sameElement).toBeGreaterThan(0)
  })

  it('names a dragon after its element and form', () => {
    expect(dragonName('fire_drake')).toBe('Fire Drake')
    expect(dragonName('water_wyrm')).toBe('Water Wyrm')
  })
})

/**
 * The Phase 6 fuzz.
 *
 * Unlike every rung before it, this one reaches real combat on its own: both players
 * start a dragon on the Frontier, so the phase fires as soon as an army stands there.
 * A clean run proves nothing on its own, though -- hence the counters, which are the
 * lesson Phase 4e wrote down about Choke.
 */
describe('dragon self-play', () => {
  const GAMES = 120

  const counters: Record<string, number> = {}
  let stuck = 0
  const badMath: string[] = []
  const unshownBurials: string[] = []

  for (const [label, forces] of [
    ['starter', STARTER_FORCES],
    ['bestiary', BESTIARY_FORCES],
  ] as const) {
    for (let seed = 1; seed <= GAMES; seed++) {
      const result = runGame({
        setup: { seed, forces, ruleSet: DRAGON_RULES },
        players: { p1: randomAi, p2: randomAi },
        aiSeed: seed,
      })
      if (result.stoppedBecause === 'stuck') stuck++
      for (const entry of result.state.log) {
        counters[entry.kind] = (counters[entry.kind] ?? 0) + 1
        if (entry.kind === 'dragon_breath') {
          counters[`breath_${entry.element}`] = (counters[`breath_${entry.element}`] ?? 0) + 1
        }
        if (entry.kind === 'dragon_home') {
          counters[`home_${entry.why}`] = (counters[`home_${entry.why}`] ?? 0) + 1
        }
        if (entry.kind === 'units_promoted' && entry.source !== undefined) {
          counters[`promote_${entry.source}`] = (counters[`promote_${entry.source}`] ?? 0) + 1
        }
        if (entry.kind === 'units_buried' && entry.source !== undefined) {
          counters[`bury_${entry.source}`] = (counters[`bury_${entry.source}`] ?? 0) + 1
        }
        if (entry.kind === 'sai_sub_roll' && entry.fate === 'bury') {
          counters['fire_roll'] = (counters['fire_roll'] ?? 0) + 1
          if (entry.escaped.length > 0) counters['fire_saved'] = (counters['fire_saved'] ?? 0) + 1
        }
        if (entry.kind === 'dragon_damage') {
          const { incoming, answered, duels } = entry
          if (incoming !== undefined) {
            counters['math_incoming'] = (counters['math_incoming'] ?? 0) + 1
            if (incoming.damage !== Math.max(0, incoming.inflicted - incoming.saves - (incoming.bash ?? 0))) {
              badMath.push(`seed ${seed}: ${JSON.stringify(incoming)}`)
            }
          }
          for (const a of answered ?? []) {
            counters['math_answered'] = (counters['math_answered'] ?? 0) + 1
            if (a.slain !== (a.melee >= a.threshold || a.missile >= a.threshold)) {
              badMath.push(`seed ${seed}: ${JSON.stringify(a)}`)
            }
          }
          for (const d of duels ?? []) {
            counters['math_duel'] = (counters['math_duel'] ?? 0) + 1
            if (d.slain !== d.damage >= d.threshold) badMath.push(`seed ${seed}: ${JSON.stringify(d)}`)
          }
        }
        if (entry.kind === 'units_buried' && entry.source === 'dragon_fire') {
          // Right before it -- or before the Rise from the Ashes line a Phoenix rolls on its
          // way to the BUA, which sits between the two.
          const i = result.state.log.indexOf(entry)
          const prior = result.state.log[i - 1]
          const before = prior?.kind === 'units_risen' ? result.state.log[i - 2] : prior
          const shown = before?.kind === 'sai_sub_roll' && before.fate === 'bury' ? before : undefined
          if (shown === undefined || !entry.unitIds.every((id) => shown.dice.some((d) => d.unitId === id))) {
            unshownBurials.push(`seed ${seed}: ${entry.unitIds.join(', ')}`)
          }
        }
        if (entry.kind === 'dragon_attack') {
          for (const shown of entry.dragons) {
            for (const { icon } of shown.faces) {
              counters[`icon_${icon}`] = (counters[`icon_${icon}`] ?? 0) + 1
            }
          }
        }
      }
    }
    void label
  }

  it('never gets stuck', () => {
    expect(stuck).toBe(0)
  })

  /**
   * Phase 9c: "12 damage − 4 saves = 8" and "7 melee vs 10 → survives" are written into
   * the log now, so they had better be the arithmetic the phase actually did. All three
   * halves -- the army's losses, its answer, and a duel -- have to turn up.
   */
  it('writes the damage arithmetic both ways, and it adds up', () => {
    expect(badMath).toEqual([])
    expect(counters['math_incoming'] ?? 0).toBeGreaterThan(0)
    expect(counters['math_answered'] ?? 0).toBeGreaterThan(0)
    expect(counters['math_duel'] ?? 0).toBeGreaterThan(0)
  })

  it('fires every dragon icon in the box', () => {
    for (const icon of ['JAWS', 'CLAW', 'BELLY', 'TAIL', 'WING', 'TREASURE', 'BREATH']) {
      expect(counters[`icon_${icon}`] ?? 0, icon).toBeGreaterThan(0)
    }
  })

  /** Death is unreachable *here*: neither starter species can draw it. The Goblins can
   *  (v2 Phase 7), and the Death breath's own test is below, outside this fuzz. */
  it('fires all four reachable breaths, and never the fifth', () => {
    for (const element of ['air', 'earth', 'fire', 'water']) {
      expect(counters[`breath_${element}`] ?? 0, element).toBeGreaterThan(0)
    }
    expect(counters['breath_death'] ?? 0).toBe(0)
  })

  it('kills dragons, sends them home on a wing, and promotes for both reasons', () => {
    expect(counters['home_slain'] ?? 0).toBeGreaterThan(0)
    expect(counters['home_flew'] ?? 0).toBeGreaterThan(0)
    expect(counters['promote_dragon_treasure'] ?? 0).toBeGreaterThan(0)
    expect(counters['promote_dragon_slain'] ?? 0).toBeGreaterThan(0)
  })

  /** Fire's conditional burial -- the one breath that is not a duration effect. */
  it('buries what a Fire breath kills and a save roll does not spare', () => {
    expect(counters['bury_dragon_fire'] ?? 0).toBeGreaterThan(0)
  })

  /**
   * And the roll that decides it is on the log, both ways. It used to be logged only
   * through its consequence: a burial with no dice, and a save with nothing at all --
   * reported from a game where a Treefolk killed by Dragon Fire showed no roll.
   */
  it('logs the Dragon Fire save roll, saves and burials alike', () => {
    expect(unshownBurials).toEqual([])
    expect(counters['fire_roll'] ?? 0).toBeGreaterThan(0)
    expect(counters['fire_saved'] ?? 0).toBeGreaterThan(0)
  })

  /**
   * "Skip this step if no army is being attacked" (p. 18 step 6).
   *
   * Found in a browser rather than by a test: two duelling dragons had the army
   * rolling anyway, which spends randomness the rules do not and would let an army
   * kill a dragon that never came near it. The starter matchup duels on turn one
   * every time, so this is the common case and not an edge one.
   */
  /**
   * A decision with one legal answer is not a decision -- the same rule that drops
   * a damage assignment too small to kill anything. Against a single dragon every
   * result goes at the only target there is, so whether it dies is arithmetic.
   */
  it('never asks how to split damage against a single dragon', () => {
    let splits = 0
    let soloAttacks = 0
    for (let seed = 1; seed <= 60; seed++) {
      const result = runGame({
        setup: { seed, forces: STARTER_FORCES, ruleSet: DRAGON_RULES },
        players: { p1: randomAi, p2: randomAi },
        aiSeed: seed,
      })
      for (const action of result.record.actions) {
        if (action.kind === 'dragon_damage_split') splits++
      }
      for (const entry of result.state.log) {
        if (entry.kind === 'dragon_attack' && entry.dragons.length === 1) soloAttacks++
      }
    }
    // Lone dragons are the common case once the first duel clears the Frontier,
    // and the starter matchup never fields two of one element -- so no split.
    expect(soloAttacks).toBeGreaterThan(0)
    expect(splits).toBe(0)
  })

  /**
   * ...and the other half, or the rule above would just be "never ask". Two
   * same-element dragons do not fight each other, so both go for the army and the
   * split becomes a real decision -- reachable only in a mirror, where both players
   * draw from the same pair of elements.
   */
  it('asks when two same-element dragons both go for the army', () => {
    const mirror: ForceSpec = {
      kind: 'named',
      forces: { p1: 'treefolk_darktree', p2: 'treefolk_redwood' },
    }
    let splits = 0
    let bothOnArmy = 0
    for (let seed = 1; seed <= 60; seed++) {
      const result = runGame({
        setup: { seed, forces: mirror, ruleSet: DRAGON_RULES },
        players: { p1: randomAi, p2: randomAi },
        aiSeed: seed,
      })
      for (const action of result.record.actions) {
        if (action.kind === 'dragon_damage_split') splits++
      }
      for (const entry of result.state.log) {
        if (
          entry.kind === 'dragon_attack' &&
          entry.dragons.length === 2 &&
          entry.dragons.every((d) => d.target.kind === 'army')
        ) {
          bothOnArmy++
        }
      }
    }
    expect(bothOnArmy).toBeGreaterThan(0)
    expect(splits).toBeGreaterThan(0)
  })

  /**
   * The sheet that asks for the allocation has to *show* the roll -- how many IDs
   * there are to spend is the question, and which dice already gave melee or saves
   * is what decides where they go.
   *
   * It crashed the first time: rendering means resolving a combination roll, and
   * `allocateIds` refuses one whose allocation does not spend the pool exactly. A
   * display pass has no allocation yet, so it has to supply a throwaway one. No
   * test rendered the sheet, so only the browser found it.
   */
  it('can show the roll at the pause that asks how to split it', () => {
    for (let seed = 1; seed <= 80; seed++) {
      let state = begin(setupGame({ seed, forces: STARTER_FORCES, ruleSet: DRAGON_RULES }))
      let rng = rngFrom(seed)

      for (let step = 0; step < 400 && state.winner === null && state.pending !== null; step++) {
        // Whatever is on the table must be renderable at every pause, not only this
        // one -- the sheets call it unconditionally.
        expect(() => rollOnTheTable(state), `seed ${seed}`).not.toThrow()

        if (state.pending.kind === 'dragon_allocate') {
          const roll = rollOnTheTable(state)
          expect(roll, `seed ${seed}`).not.toBeNull()
          expect(roll?.kind).toBe('dragon')
          // The army rolled, so there are dice to look at.
          expect(roll?.dice.length ?? 0).toBeGreaterThan(0)
          return
        }

        const [action, next] = randomAi.decide(state, state.pending, rng)
        rng = next
        state = reduce(state, action)
      }
    }
    throw new Error('no dragon allocation was reached in 80 games')
  })

  /**
   * A die that contributed to *any* counted type is not a blank.
   *
   * The per-die number was read off the roll's first kind only, so in a roll
   * counting melee, missile and save a die that rolled four saves reported zero --
   * and the strip greyed it out as having done nothing, beside a total that was
   * counting it.
   */
  it('counts a save die in a dragon roll, so the strip does not grey it out', () => {
    const units = [
      { id: 'u1', typeId: 'treefolk.oak', owner: 'p1' as const, location: { kind: 'reserve' as const } },
    ]
    // The Oak's `4 SAVE` face -- the outsized one invariant 7 exists for.
    const saveFace = unitType('treefolk.oak').faces.findIndex(
      (f) => f.icon === 'SAVE' && f.count === 4,
    )
    expect(saveFace).toBeGreaterThanOrEqual(0)

    const spec = {
      kinds: DRAGON_ROLL_KINDS,
      modifiers: [],
      context: { purpose: { kind: 'dragon_attack' as const }, isCounter: false },
      idAllocation: { melee: 0, missile: 0, save: 0 },
    }
    const outcome = resolveFaces(
      [{ unitId: 'u1', typeId: 'treefolk.oak', faceIndex: saveFace }],
      spec,
      DRAGON_RULES,
    )
    void units
    expect(outcome.totals.save).toBe(4)
    // The die's own number, which is what decides whether the strip greys it.
    expect(outcome.dice[0]?.results).toBe(4)
  })

  it('does not roll the army when both dragons are busy with each other', () => {
    const state = setupGame({ seed: 7, forces: STARTER_FORCES, ruleSet: DRAGON_RULES })
    const targets = [...dragonTargets(state, 'frontier', 'p1').settled.values()]
    expect(targets.every((t) => t.kind === 'dragon')).toBe(true)

    const result = runGame({
      setup: { seed: 7, forces: STARTER_FORCES, ruleSet: DRAGON_RULES },
      players: { p1: randomAi, p2: randomAi },
      aiSeed: 7,
    })
    // The first dragon attack is the all-duel one, and it must produce no army roll.
    const upToFirstAttack: string[] = []
    for (const entry of result.state.log) {
      upToFirstAttack.push(entry.kind)
      if (entry.kind === 'dragon_roll') break
    }
    const firstAttack = upToFirstAttack.indexOf('dragon_attack')
    const firstArmyRoll = upToFirstAttack.indexOf('dragon_roll')
    expect(firstAttack).toBeGreaterThanOrEqual(0)
    // Either no army roll happened at all, or one did but only after a later attack
    // in which a dragon actually targeted the army.
    if (firstArmyRoll >= 0) {
      const attacksBefore = upToFirstAttack
        .slice(0, firstArmyRoll)
        .filter((kind) => kind === 'dragon_attack').length
      expect(attacksBefore).toBeGreaterThan(1)
    }
  })
})

describe('the two choices Summon Dragon made real', () => {
  /**
   * Phase 6 put at most one dragon per player on the board and nothing could move one,
   * so a dragon never had two eligible targets and dragons never stood at two terrains
   * at once. Both were fixed in board order with a comment promising Phase 7. Summon
   * Dragon is what redeemed it -- and neither is reachable often enough for a fuzz to
   * find, which is why they are named tests.
   */
  it('asks the owner which dragon to attack when more than one is eligible', () => {
    const state = threeAtFrontier()
    const { settled, choices } = dragonTargets(state, 'frontier', 'p1')

    // The water drake may attack either fire dragon; each fire dragon has exactly one
    // enemy and so is settled, never asked about.
    expect([...choices.keys()]).toEqual(['water'])
    expect([...(choices.get('water') ?? [])].sort()).toEqual(['fireA', 'fireB'])
    expect(settled.get('fireA')).toEqual({ kind: 'dragon', dragonId: 'water' })
    expect(settled.get('fireB')).toEqual({ kind: 'dragon', dragonId: 'water' })
  })

  it('still settles a lone eligible target without asking', () => {
    const state = placed({ p1d: 'water_drake', p2d: 'fire_drake' })
    const { settled, choices } = dragonTargets(state, 'frontier', 'p1')
    expect(choices.size).toBe(0)
    expect(settled.get('p1d')).toEqual({ kind: 'dragon', dragonId: 'p2d' })
  })

  it('never offers a dragon its own element, however many are present', () => {
    const state = placed({ a: 'fire_drake', b: 'fire_wyrm', c: 'fire_drake' })
    const { settled, choices } = dragonTargets(state, 'frontier', 'p1')
    // Same-element dragons never attack each other, so all three go for the army.
    expect(choices.size).toBe(0)
    for (const [, target] of settled) expect(target).toEqual({ kind: 'army', player: 'p1' })
  })

  it('raises the declaration through the real machine, and rolls only after it', () => {
    const state = begin(atDragonPhase(threeAtFrontier()))

    expect(state.pending?.kind).toBe('dragon_target')
    // Nothing has been thrown: breath rerolls against a dragon and not against an
    // army, so every target has to be settled before any die is.
    expect(state.log.some((e) => e.kind === 'dragon_attack')).toBe(false)

    const pending = state.pending as Extract<Pending, { kind: 'dragon_target' }>
    const answered = reduce(state, {
      kind: 'dragon_target',
      targets: { [pending.choices[0]!.dragonId]: pending.choices[0]!.options[1]! },
    })
    expect(answered.log.some((e) => e.kind === 'dragon_attack')).toBe(true)
  })

  it('lets the marching player order two terrains, and asks nothing about one', () => {
    const one = begin(atDragonPhase(placed({ a: 'fire_drake' })))
    expect(one.pending?.kind).not.toBe('dragon_order')

    const two = begin(atDragonPhase(atTerrains({ a: 'fire_drake' }, { b: 'water_drake' })))
    expect(two.pending?.kind).toBe('dragon_order')
    const options = (two.pending as Extract<Pending, { kind: 'dragon_order' }>).options
    expect([...options].sort()).toEqual(['frontier', 'p1_home'])
  })

  it('does not ask twice about a terrain whose dragons have already attacked', () => {
    // `dragonsDone` is what makes "what is left" a fact rather than a board-index
    // comparison, now that the order is the player's to choose.
    let state = begin(atDragonPhase(atTerrains({ a: 'fire_drake' }, { b: 'water_drake' })))
    let asked = 0
    for (let i = 0; i < 200 && state.pending !== null && state.winner === null; i += 1) {
      if (state.pending.kind === 'dragon_order') asked += 1
      if (state.turn.phase !== 'dragon_attack') break
      state = reduce(state, passiveAi.decide(state, state.pending, { seed: 1, counter: 0 })[0])
    }
    // Two terrains, so exactly one order decision: the second is forced.
    expect(asked).toBe(1)
    // And each terrain's dragons attack once. Counting questions alone missed the
    // repeat: beginning the second attack erased `dragonsDone`, so the first terrain
    // attacked again -- forced, so nothing was asked (seed 88086, turn 11).
    const attacks = state.log.flatMap((e) => (e.kind === 'dragon_attack' ? [e.slot] : []))
    expect(new Set(attacks).size).toBe(attacks.length)
  })

  it('keeps dragonsDone when the next terrain begins', () => {
    let state = begin(atDragonPhase(atTerrains({ a: 'fire_drake' }, { b: 'water_drake' })))
    for (let i = 0; i < 200 && state.pending !== null && state.winner === null; i += 1) {
      if (state.turn.dragonAttack !== undefined && (state.turn.dragonsDone ?? []).length > 0) break
      state = reduce(state, passiveAi.decide(state, state.pending, { seed: 1, counter: 0 })[0])
    }
    // Mid-way through the second terrain, the first is still on the done list.
    expect(state.turn.dragonAttack).toBeDefined()
    expect(state.turn.dragonsDone).toHaveLength(1)
  })
})

/** Three dragons at the Frontier: one water against two fire, so the water drake has
 *  a choice and the two fire dragons do not. */
function threeAtFrontier(): GameState {
  return placed({ water: 'water_drake', fireA: 'fire_drake', fireB: 'fire_wyrm' })
}

describe('the Death breath, in a game (v2 Phase 7e)', () => {
  /**
   * Reachable since the Goblins: a Death species summons a Death dragon. The live fuzz
   * reached it in 1000 games once and missed it the next time the random games changed
   * course, so it is driven here rather than left to chance: a Death Drake breathes on
   * the marching army, the army pays five health-worth, and Dragon Plague stays on it.
   */
  it('kills five health-worth and leaves the army ignoring its IDs', () => {
    let seed = 1
    for (; seed < 2000; seed += 1) {
      const [rolls] = rollDragon('p2:d', 'death_drake', false, rngFrom(seed))
      const first = rolls[0]
      if (rolls.length === 1 && first !== undefined && dragonFaceIcon('death_drake', first.faceIndex as DragonFaceNumber) === 'BREATH') break
    }
    let state = advance({ ...atDragonPhase(placed({ 'p2:d': 'death_drake' })), rng: rngFrom(seed) })
    while (state.pending?.kind === 'dragon_breath') {
      const pending = state.pending
      const army = armyAt(state, pending.player, pending.slot)
      state = advance(reduce(state, { kind: 'dragon_breath', unitIds: damageOptions(army, pending.health).suggestion }))
    }
    const breath = state.log.filter((e) => e.kind === 'dragon_breath')
    expect(breath.map((e) => (e.kind === 'dragon_breath' ? e.element : null))).toEqual(['death'])
    expect(state.log.some((e) => e.kind === 'dragon_breath_effect' && e.element === 'death')).toBe(true)
  })
})

/** A real board under the dragon rules, with the given dragons placed. */
function placed(spec: Readonly<Record<string, string>>): GameState {
  return atTerrains(spec, {})
}

function atTerrains(
  frontier: Readonly<Record<string, string>>,
  home: Readonly<Record<string, string>>,
): GameState {
  const base = setupGame({ seed: 5, forces: STARTER_FORCES, firstPlayer: 'p1', ruleSet: DRAGON_RULES })
  const dragons: Record<string, DragonInPlay> = {}
  const place = (spec: Readonly<Record<string, string>>, slot: TerrainSlot) => {
    for (const [id, dieId] of Object.entries(spec)) {
      dragons[id] = { id, dieId, owner: id.startsWith('p2') ? 'p2' : 'p1', location: { kind: 'terrain', slot } }
    }
  }
  place(frontier, 'frontier')
  place(home, 'p1_home')
  return { ...base, dragons }
}

/** Wound forward to the Dragon Attack Phase, with nothing before it to answer. */
function atDragonPhase(state: GameState): GameState {
  return { ...state, turn: { ...state.turn, phase: 'dragon_attack' } }
}
