/**
 * A run that plays itself, outside its battles (v3 Phase 2).
 *
 * `--p1-ai` watches a run, and a run asks more than a game does: which race, which force,
 * which reward, which event. These answers are plain rules of thumb, not an AI -- `src/run/`
 * may not import `src/ai/`, and nothing here needs to be clever to give a curve its first
 * look. `suggestForce` doubles as the terminal's `auto`, which fills a force for a player
 * who would rather not type one.
 *
 * Deterministic and drawing nothing: the same run gets the same answers.
 */
import type { Collection } from '../data/collections'
import { unitType } from '../data/load'
import { dragonCount, repairSplit, type BuiltForce } from '../engine/force'
import { forceProblems, used } from '../engine/forceProblems'
import { homeDiceFor } from '../engine/setup'

import { upgradeOf } from './draws'
import { ACT_SIZE, IllegalRunAction, type RunAction, type RunState } from './types'

/** Every copy the pool owns of one kind, one id per copy, sorted by id. */
const copies = (collection: Collection, kind: 'units' | 'dragons' | 'terrains'): string[] =>
  Object.entries(collection[kind])
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, n]) => Array<string>(n).fill(id))

/** Takes one copy of `id` out of `from`, if there is one. */
function take(from: string[], id: string | undefined): string | undefined {
  if (id === undefined) return undefined
  const at = from.indexOf(id)
  if (at < 0) return undefined
  from.splice(at, 1)
  return id
}

/**
 * A legal force from the pool under `cap`, or null when the pool cannot make one.
 *
 * - **Dice**: heaviest first while they fit under the cap, dealt heaviest-first into the
 *   lightest army (`repairSplit`). When that puts an army over half the force, the
 *   heaviest die chosen sits out and the fill runs again -- so a pool of one monster and
 *   two small dice fields the two small dice and a third, not nothing.
 * - **Terrains**: the current Home and Frontier when the pool still holds them; otherwise
 *   a Home of the race's own type if one is owned, and any other owned die.
 * - **Dragons**: the current ones the pool still holds, then any owned, up to the count
 *   the force's size allows.
 */
export function suggestForce(run: RunState, cap: number): BuiltForce | null {
  const units = copies(run.collection, 'units').sort((a, b) => unitType(b).health - unitType(a).health)
  const terrains = copies(run.collection, 'terrains')
  const dragonPool = copies(run.collection, 'dragons')
  if (terrains.length < 2 || dragonPool.length === 0) return null

  const own = run.race === null ? [] : homeDiceFor(run.race)
  const home = take(terrains, run.force.homeTerrain) ?? take(terrains, terrains.find((id) => own.includes(id))) ?? terrains.shift()
  const frontier = take(terrains, run.force.frontierProposal) ?? terrains.shift()
  if (home === undefined || frontier === undefined) return null

  const benched = new Set<number>()
  while (benched.size < units.length) {
    const chosen: string[] = []
    let health = 0
    units.forEach((id, i) => {
      if (benched.has(i) || health + unitType(id).health > cap) return
      chosen.push(id)
      health += unitType(id).health
    })
    if (chosen.length < 3) return null

    const wanted = dragonCount(health)
    const dragons: string[] = []
    const left = [...dragonPool]
    for (const id of [...(run.force.dragons ?? []), ...dragonPool]) {
      if (dragons.length < wanted && take(left, id) !== undefined) dragons.push(id)
    }
    const force: BuiltForce = { armies: repairSplit(chosen), homeTerrain: home, frontierProposal: frontier, dragons }
    if (forceProblems(run.collection, cap, force, 'at_most').length === 0) return force

    // Sit the heaviest chosen die out and fill again.
    const heaviest = units.findIndex((id, i) => !benched.has(i) && chosen.includes(id))
    benched.add(heaviest)
  }
  return null
}

const sameForce = (a: BuiltForce, b: BuiltForce): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The autopilot's answer to any run pending but a battle, which is the client's to play,
 * and the end, which nothing answers:
 * - **race**: picked by the seed, so a watched run without `--race` still varies;
 * - **force**: `suggestForce`, then ready;
 * - **reward**: a dragon while the force is short of the two Act III asks for, else the
 *   heaviest unit offered (the first of equals), else the first offer;
 * - **event**: upgrade a medium die to large if it can, else a small to medium, else skip.
 *   A transform is a sideways move, and a rule of thumb has no reason to want one.
 */
export function autopilot(run: RunState): RunAction {
  const pending = run.pending
  switch (pending.kind) {
    case 'choose_race': {
      const race = pending.races[run.seed % pending.races.length]
      if (race === undefined) throw new IllegalRunAction('there is no race to pick')
      return { kind: 'pick_race', race }
    }
    case 'arrange_force': {
      const force = suggestForce(run, pending.cap)
      if (force === null) {
        if (forceProblems(run.collection, pending.cap, run.force, 'at_most').length === 0) return { kind: 'ready' }
        throw new IllegalRunAction('the pool cannot make a legal force')
      }
      return sameForce(force, run.force) ? { kind: 'ready' } : { kind: 'set_force', force }
    }
    case 'reward': {
      const ownedDragons = Object.values(run.collection.dragons).reduce((n, c) => n + c, 0)
      const dragon = pending.offers.findIndex((o) => o.kind === 'dragon')
      if (ownedDragons < dragonCount(ACT_SIZE[3]) && dragon >= 0) return { kind: 'take_offer', index: dragon }
      let best = 0
      let bestHealth = -1
      pending.offers.forEach((offer, index) => {
        if (offer.kind !== 'unit') return
        const health = unitType(offer.id).health
        if (health > bestHealth) [best, bestHealth] = [index, health]
      })
      return { kind: 'take_offer', index: best }
    }
    case 'event': {
      for (const size of ['medium', 'small'] as const) {
        const unit = pending.upgradable.find((id) => unitType(id).size === size && upgradeOf(id) !== null)
        if (unit !== undefined) return { kind: 'upgrade', unit }
      }
      return { kind: 'skip' }
    }
    case 'battle':
      throw new IllegalRunAction('a battle is played, not answered by the autopilot')
    case 'over':
      throw new IllegalRunAction('the run is over')
  }
}

/** How much of a force's health the pool could field but does not: what `auto` gains. */
export function unfieldedHealth(run: RunState): number {
  const owned = copies(run.collection, 'units')
  let spare = 0
  for (const id of new Set(owned)) {
    const extra = owned.filter((o) => o === id).length - used(run.force, 'units', id)
    if (extra > 0) spare += extra * unitType(id).health
  }
  return spare
}
