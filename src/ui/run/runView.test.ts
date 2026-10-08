/**
 * The run screens' rules, without a DOM (v3 Phase 4b).
 */
import { describe, expect, it } from 'vitest'

import { newRun, reduceRun } from '../../run/reduce'
import type { RunAction, RunState } from '../../run/types'

import {
  actStrip,
  battleOutcome,
  concedeAsk,
  freshDice,
  offerText,
  outcomeText,
  runStats,
  runWhere,
  runWhereShort,
  savedRunView,
  savedWhen,
} from './runView'

/** A run played on rails: every battle won but one, every reward the first offer, every event skipped. */
function playTo(seed: number, until: (run: RunState) => boolean, loseAt: string | null = null): RunState {
  let run = reduceRun(newRun(seed), { kind: 'pick_race', race: 'treefolk' })
  while (!until(run) && run.pending.kind !== 'over') {
    const kind = run.pending.kind
    const action: RunAction =
      kind === 'arrange_force'
        ? { kind: 'ready' }
        : kind === 'battle'
          ? { kind: 'battle_ended', winner: run.current?.id === loseAt ? 'p2' : 'p1' }
          : kind === 'reward'
            ? { kind: 'take_offer', index: 0 }
            : { kind: 'skip' }
    run = reduceRun(run, action)
  }
  return run
}

describe('actStrip', () => {
  it('rings the encounter in hand and leaves the rest of the run ahead', () => {
    const run = playTo(3, () => true)
    const [one, two, three] = actStrip(run)
    expect(one).toMatchObject({ act: 1, cap: 12, state: 'now' })
    expect(one?.slots).toEqual(['here', ...Array(11).fill('ahead')])
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
    expect(runWhere(run)).toBe('Act II · 3 of 12')
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

describe('the words', () => {
  it('says whose race an offered die is', () => {
    expect(offerText({ kind: 'unit', id: 'treefolk.oak' }, 'treefolk')).toMatchObject({ kind: 'Your race', name: 'Oak' })
    expect(offerText({ kind: 'unit', id: 'coral_elves.knight' }, 'treefolk')).toMatchObject({ kind: 'Coral Elves', name: 'Knight' })
    expect(offerText({ kind: 'dragon', id: 'water_wyrm' }, 'treefolk')).toMatchObject({ kind: 'Dragon', name: 'Water Wyrm' })
    expect(offerText({ kind: 'terrain', id: 'swampland_city' }, null).kind).toBe('Terrain')
  })

  it('names each way an encounter can end', () => {
    const at = { act: 1 as const, encounter: 0, id: 'x', name: 'X' }
    expect(outcomeText({ ...at, outcome: { kind: 'won', took: { kind: 'unit', id: 'treefolk.oak' } } })).toBe('won · took Oak')
    expect(outcomeText({ ...at, outcome: { kind: 'won', took: null } })).toBe('won')
    expect(outcomeText({ ...at, outcome: { kind: 'lost' } })).toBe('lost')
    expect(outcomeText({ ...at, outcome: { kind: 'upgrade', from: 'treefolk.oak', to: 'treefolk.oak_lord' } })).toBe('upgraded Oak to Oak Lord')
    expect(outcomeText({ ...at, outcome: { kind: 'skip' } })).toBe('walked on')
  })

  it('counts a run for its end', () => {
    const run = playTo(5, (r) => r.act === 2)
    const stats = runStats(run)
    expect(stats.battlesWon + stats.events).toBe(12)
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
        { kind: 'won', took: { kind: 'unit', id: 'treefolk.oak' } },
        { kind: 'upgrade', from: 'treefolk.oakling', to: 'treefolk.oak' },
        { kind: 'won', took: { kind: 'dragon', id: 'earth_wyrm' } },
        { kind: 'transform', from: 'treefolk.pine', to: 'treefolk.willow' },
        { kind: 'skip' },
      ]),
    )
    expect([...fresh.units]).toEqual(['treefolk.willow'])
    expect([...fresh.dragons]).toEqual(['earth_wyrm'])
  })

  it('has nothing new at the opening, or after a terrain reward', () => {
    expect(freshDice(run([])).units.size).toBe(0)
    const terrain = freshDice(run([{ kind: 'won', took: { kind: 'terrain', id: 'swampland_city' } }]))
    expect(terrain.units.size + terrain.dragons.size).toBe(0)
  })
})

describe('savedRunView', () => {
  const now = new Date(2026, 9, 8, 15, 0)
  it('offers a run in progress by race and place, and says when it was saved', () => {
    const run = playTo(3, (r) => r.encounter === 2)
    const view = savedRunView({ kind: 'ok', run, savedAt: new Date(2026, 9, 8, 14, 2).toISOString() }, now)
    expect(view).toMatchObject({ kind: 'playing', title: 'A Treefolk run · Act I · 3 of 12' })
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
    const run = playTo(3, (r) => r.act === 2 && r.encounter === 4 && r.pending.kind === 'battle')
    expect(runWhere(run)).toBe('Act II · 5 of 12')
    expect(runWhereShort(run)).toBe('II·5')
    const ask = concedeAsk(run)
    expect(ask.question).toBe(`Concede ${run.current?.name}?`)
    expect(ask.detail).toMatch(/^A lost battle ends the run: your Treefolk run stops at Act II · 5 of 12\./)
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
