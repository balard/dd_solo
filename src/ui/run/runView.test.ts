/**
 * The run screens' rules, without a DOM (v3 Phase 4b).
 */
import { describe, expect, it } from 'vitest'

import { newRun, reduceRun } from '../../run/reduce'
import { actLength, type Grant, type Offer, type RunAction, type RunState } from '../../run/types'

import {
  actStrip,
  battleOutcome,
  concedeAsk,
  eventResult,
  freshDice,
  offerText,
  outcomeText,
  runStats,
  runWhere,
  runWhereShort,
  savedRunView,
  savedWhen,
} from './runView'

/** A run played on rails: every battle won but one, every reward and boon the first offer,
 *  every event its lone small die. */
function playTo(seed: number, until: (run: RunState) => boolean, loseAt: string | null = null): RunState {
  let run = reduceRun(newRun(seed), { kind: 'pick_race', race: 'treefolk' })
  while (!until(run) && run.pending.kind !== 'over') {
    const kind = run.pending.kind
    const action: RunAction =
      kind === 'arrange_force'
        ? { kind: 'ready' }
        : kind === 'battle'
          ? { kind: 'battle_ended', winner: run.current?.id === loseAt ? 'p2' : 'p1' }
          : kind === 'event'
            ? { kind: 'take_small' }
            : { kind: 'take_offer', index: 0 }
    run = reduceRun(run, action)
  }
  return run
}

describe('actStrip', () => {
  it('rings the encounter in hand and leaves the rest of the run ahead', () => {
    const run = playTo(3, () => true)
    const [one, two, three] = actStrip(run)
    expect(one).toMatchObject({ act: 1, cap: 12, state: 'now' })
    expect(one?.slots).toEqual(['here', ...Array(actLength(1) - 1).fill('ahead')])
    expect(three?.slots).toHaveLength(actLength(3))
    expect(two?.state).toBe('ahead')
    expect(three?.slots.every((s) => s === 'ahead')).toBe(true)
  })

  it('draws what each finished encounter came to, from the history', () => {
    const run = playTo(3, (r) => r.act === 2 && r.encounter === 2)
    const [one, two] = actStrip(run)
    expect(one?.state).toBe('done')
    expect(one?.slots).toEqual(run.history.filter((h) => h.act === 1).map((h) => (h.outcome.kind === 'won' ? 'won' : 'event')))
    expect(two?.slots.slice(0, 3)).toEqual([
      ...run.history.filter((h) => h.act === 2).map((h) => (h.outcome.kind === 'won' ? 'won' : 'event')),
      'here',
    ])
    expect(runWhere(run)).toBe(`Act II · 3 of ${actLength(2)}`)
  })

  it('marks the battle lost and rings nothing once the run is over', () => {
    const first = playTo(3, (r) => r.pending.kind === 'battle')
    const lost = playTo(3, () => false, first.current?.id ?? null)
    expect(lost.status).toBe('lost')
    const slots = actStrip(lost).flatMap((a) => a.slots)
    expect(slots).toContain('lost')
    expect(slots).not.toContain('here')
  })
})

/** An offer of these dice, one copy each unless a count is given. */
const offer = (...grants: readonly (readonly [Grant['kind'], string, number?])[]): Offer => ({
  grants: grants.map(([kind, id, count = 1]) => ({ kind, id, count, flavour: 'similar' })),
})

describe('the words', () => {
  it('says whose race an offered die is', () => {
    expect(offerText(offer(['unit', 'treefolk.oak']), 'treefolk')).toMatchObject({ kind: 'Your race', name: 'Oak' })
    expect(offerText(offer(['unit', 'coral_elves.knight']), 'treefolk')).toMatchObject({ kind: 'Coral Elves', name: 'Knight' })
    expect(offerText(offer(['dragon', 'water_wyrm']), 'treefolk')).toMatchObject({ kind: 'Dragon', name: 'Water Wyrm' })
    expect(offerText(offer(['terrain', 'swampland_city']), null).kind).toBe('Terrain')
  })

  it('names every die of a bundled offer, with its count (v3 Phase 6)', () => {
    const text = offerText(offer(['unit', 'treefolk.oakling', 3], ['dragon', 'fire_drake']), 'treefolk')
    expect(text).toMatchObject({ kind: 'Your race + Dragon', name: 'Oakling ×3 + Fire Drake' })
    expect(text.detail).toMatch(/^Treefolk · 3 health · /)
  })

  it('names each way an encounter can end', () => {
    const at = { act: 1 as const, encounter: 0, id: 'x', name: 'X' }
    expect(outcomeText({ ...at, outcome: { kind: 'won', took: offer(['unit', 'treefolk.oak']) } })).toBe('won · took Oak')
    expect(outcomeText({ ...at, outcome: { kind: 'won', took: null } })).toBe('won')
    expect(outcomeText({ ...at, outcome: { kind: 'lost' } })).toBe('lost')
    expect(outcomeText({ ...at, outcome: { kind: 'upgrade', from: 'treefolk.oak', to: 'treefolk.oak_lord' } })).toBe('upgraded Oak to Oak Lord')
    expect(
      outcomeText({ ...at, outcome: { kind: 'transform', from: 'treefolk.oak', to: 'treefolk.pine', small: 'treefolk.nymph' } }),
    ).toBe('took Nymph, transformed Oak into Pine')
    expect(outcomeText({ ...at, outcome: { kind: 'small', took: 'treefolk.nymph' } })).toBe('took Nymph')
    expect(outcomeText({ ...at, outcome: { kind: 'boon', took: offer(['dragon', 'fire_drake']) } })).toBe('took Fire Drake')
  })

  it('counts a run for its end', () => {
    const run = playTo(5, (r) => r.act === 2)
    const stats = runStats(run)
    expect(stats.battlesWon + stats.events).toBe(actLength(1))
    expect(stats.poolHealth).toBeGreaterThanOrEqual(12)
    expect(stats.dragons).toBeGreaterThanOrEqual(1)
  })
})

describe('freshDice', () => {
  const at = { act: 1 as const, id: 'x', name: 'X' }
  const run = (outcomes: RunState['history'][number]['outcome'][]): RunState => ({
    ...newRun(1),
    history: outcomes.map((outcome, encounter) => ({ ...at, encounter, outcome })),
  })

  it('lights the last reward and every event since, and nothing before that battle', () => {
    const fresh = freshDice(
      run([
        { kind: 'won', took: offer(['unit', 'treefolk.oak']) },
        { kind: 'upgrade', from: 'treefolk.oakling', to: 'treefolk.oak' },
        { kind: 'won', took: offer(['unit', 'treefolk.pineling'], ['dragon', 'earth_wyrm']) },
        { kind: 'transform', from: 'treefolk.pine', to: 'treefolk.willow', small: 'treefolk.nymph' },
        { kind: 'boon', took: offer(['dragon', 'fire_drake']) },
        { kind: 'small', took: 'treefolk.hamadryad' },
      ]),
    )
    expect([...fresh.units].sort()).toEqual(['treefolk.hamadryad', 'treefolk.nymph', 'treefolk.pineling', 'treefolk.willow'])
    expect([...fresh.dragons].sort()).toEqual(['earth_wyrm', 'fire_drake'])
  })

  it('has nothing new at the opening, or after a terrain reward', () => {
    expect(freshDice(run([])).units.size).toBe(0)
    const terrain = freshDice(run([{ kind: 'won', took: offer(['terrain', 'swampland_city']) }]))
    expect(terrain.units.size + terrain.dragons.size).toBe(0)
  })
})

describe('savedRunView', () => {
  const now = new Date(2026, 9, 8, 15, 0)
  it('offers a run in progress by race and place, and says when it was saved', () => {
    const run = playTo(3, (r) => r.encounter === 2)
    const view = savedRunView({ kind: 'ok', run, savedAt: new Date(2026, 9, 8, 14, 2).toISOString() }, now)
    expect(view).toMatchObject({ kind: 'playing', title: `A Treefolk run · Act I · 3 of ${actLength(1)}` })
    if (view.kind === 'playing') expect(view.detail).toMatch(/saved today at 14:02/)
  })

  it('does not call a beaten encounter the next one', () => {
    const fighting = playTo(3, (r) => r.pending.kind === 'battle')
    const won = reduceRun(fighting, { kind: 'battle_ended', winner: 'p1' })
    const view = savedRunView({ kind: 'ok', run: won, savedAt: now.toISOString() }, now)
    if (view.kind !== 'playing') throw new Error('expected a run in progress')
    expect(view.detail).toContain(`${fighting.current?.name} beaten, a reward to pick`)
    expect(view.detail).not.toContain('next:')
  })

  it('says a discarded save was discarded, and why', () => {
    expect(savedRunView({ kind: 'outdated', found: 1 })).toMatchObject({ kind: 'discarded' })
    expect(savedRunView({ kind: 'unreadable', reason: 'not JSON' })).toEqual({
      kind: 'discarded',
      message: 'A saved run could not be read (not JSON), and was discarded.',
    })
    expect(savedRunView({ kind: 'none' })).toEqual({ kind: 'none' })
  })

  it('says another day by its date', () => {
    expect(savedWhen(new Date(2026, 9, 3, 9, 0).toISOString(), now)).toBe('on 3 Oct')
    expect(savedWhen('nonsense', now)).toBe('some time ago')
  })
})

describe('the battle in a run', () => {
  it('names the encounter in hand, long and short', () => {
    const run = playTo(3, (r) => r.act === 2 && r.encounter >= 3 && r.pending.kind === 'battle')
    const n = run.encounter + 1
    expect(runWhere(run)).toBe(`Act II · ${n} of ${actLength(2)}`)
    expect(runWhereShort(run)).toBe(`II·${n}`)
    const ask = concedeAsk(run)
    expect(ask.question).toBe(`Concede ${run.current?.name}?`)
    expect(ask.detail.startsWith(`A lost battle ends the run: your Treefolk run stops at Act II · ${n} of ${actLength(2)}.`)).toBe(true)
    expect(ask.detail).toMatch(/use Leave run instead/)
  })

  it('leads a won battle to the reward, a lost one and the last one to the run', () => {
    const fighting = playTo(3, (r) => r.pending.kind === 'battle')
    expect(battleOutcome(fighting)).toBeNull()
    const won = reduceRun(fighting, { kind: 'battle_ended', winner: 'p1' })
    expect(battleOutcome(won)?.label).toBe('Pick your reward')
    const lost = reduceRun(fighting, { kind: 'battle_ended', winner: 'p2' })
    expect(battleOutcome(lost)).toEqual({ label: 'See the run', note: `The run ends at ${runWhere(fighting)}.` })
    const last = playTo(3, () => false)
    expect(last.status).toBe('won')
    expect(battleOutcome(last)?.note).toMatch(/the run is won/)
  })
})

describe('eventResult', () => {
  /** The first event a run on rails reaches. */
  const atEvent = (seed: number): RunState => {
    const run = playTo(seed, (r) => r.pending.kind === 'event')
    if (run.pending.kind !== 'event') throw new Error('no event reached')
    return run
  }

  it('names the change, what it did to the force, and what comes next', () => {
    const before = atEvent(2)
    // A spare copy: the pool changes and the force does not.
    const spare: RunState = { ...before, collection: { ...before.collection, units: { ...before.collection.units, 'treefolk.oakling': 2 } } }
    const after = reduceRun(spare, { kind: 'upgrade', unit: 'treefolk.oakling' })
    const result = eventResult(spare, after)
    expect(result).toMatchObject({ kind: 'upgrade', from: 'treefolk.oakling', to: 'treefolk.oak', title: 'Oakling became an Oak.' })
    expect(result?.force).toBe('It was a spare Oakling, so your force did not change.')
    expect(result?.next).toMatch(new RegExp(`^Next: ${after.current?.name}, (a battle|an event|a boon)\.$`))
  })

  it('says where a fielded die went, and when it no longer fits', () => {
    const before = atEvent(2)
    const fielded = before.force.armies.horde[0] as string
    const after = reduceRun(before, { kind: 'transform', unit: fielded })
    const result = eventResult(before, after)
    expect(result?.kind).toBe('transform')
    if (before.pending.kind !== 'event') throw new Error('not an event')
    expect(result?.small).toBe(before.pending.smalls[0]) // shown before the roll, given with it
    expect(result?.force).toMatch(/took the .* place in your Horde: 1\d of 12 health\./)
    // A full force: an upgrade of a fielded die benches it.
    const benched = eventResult(before, reduceRun(before, { kind: 'upgrade', unit: fielded }))
    expect(benched?.force).toMatch(/did not fit .* waits in your pool/)
  })

  it('is null for a small die taken alone, or when nothing new was recorded', () => {
    const before = atEvent(2)
    expect(eventResult(before, reduceRun(before, { kind: 'take_small' }))).toBeNull()
    expect(eventResult(before, before)).toBeNull()
  })
})
