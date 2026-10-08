/**
 * What the run screens have to decide, without a DOM (v3 Phase 4b) -- `prompts.ts`'s
 * arrangement for the game: a component shows these and decides none of them.
 */
import { dragonDie, dragonName, terrainDie, terrainDieName, terrainType, unitType } from '../../data/load'
import { dragonCount } from '../../engine/force'
import { forceHealth } from '../../engine/forceProblems'
import { ACTS, ACT_SIZE, ENCOUNTERS_PER_ACT, type Act, type HistoryEntry, type Offer, type RunState } from '../../run/types'
import type { RunLoad } from '../../run/save'

import { describe } from '../game/DiceGrid'
import { speciesInfo } from '../game/Elements'

export const ROMAN: Readonly<Record<Act, string>> = { 1: 'I', 2: 'II', 3: 'III' }

/** One encounter's place on the act strip. Ahead is never a kind: encounters are drawn as
 *  they are reached, so the strip does not know what is coming. */
export type SlotState = 'won' | 'lost' | 'event' | 'here' | 'ahead'

export interface ActView {
  readonly act: Act
  readonly cap: number
  readonly state: 'done' | 'now' | 'ahead'
  readonly slots: readonly SlotState[]
}

const slotOf = (entry: HistoryEntry): SlotState =>
  entry.outcome.kind === 'won' ? 'won' : entry.outcome.kind === 'lost' ? 'lost' : 'event'

/**
 * The three acts as the strip draws them, from the run's history: every finished encounter
 * in its slot, the one in hand ringed, the rest ahead. A finished run rings nothing.
 */
export function actStrip(run: RunState): readonly ActView[] {
  return ACTS.map((act) => {
    const slots: SlotState[] = Array.from({ length: ENCOUNTERS_PER_ACT }, () => 'ahead')
    for (const entry of run.history) if (entry.act === act) slots[entry.encounter] = slotOf(entry)
    if (run.status === 'playing' && run.act === act) slots[run.encounter] = 'here'
    const state = act < run.act || (run.status === 'won' && act === run.act) ? 'done' : act === run.act ? 'now' : 'ahead'
    return { act, cap: ACT_SIZE[act], state, slots }
  })
}

/** "Act II · 5 of 12". */
export const runWhere = (run: RunState): string =>
  `Act ${ROMAN[run.act]} · ${run.encounter + 1} of ${ENCOUNTERS_PER_ACT}`

export const speciesName = (id: string): string => speciesInfo(id)?.name ?? id

/** "A Treefolk run", or "A run" before a race is picked. */
export const runName = (run: RunState): string => (run.race === null ? 'A run' : `A ${speciesName(run.race)} run`)

/** How one offer reads: what kind it is, its name, and one line about it. */
export function offerText(offer: Offer, race: string | null): { kind: string; name: string; detail: string } {
  switch (offer.kind) {
    case 'unit': {
      const type = unitType(offer.id)
      const yours = race !== null && type.species === race
      return {
        kind: yours ? 'Your race' : speciesName(type.species),
        name: type.name,
        detail: `${speciesName(type.species)} · ${type.health} health · ${describe(type).replace(`${type.name} — `, '')}`,
      }
    }
    case 'dragon': {
      const die = dragonDie(offer.id)
      return { kind: 'Dragon', name: dragonName(offer.id), detail: `${die.element} · ${die.form}` }
    }
    case 'terrain': {
      const type = terrainType(terrainDie(offer.id).type)
      return { kind: 'Terrain', name: terrainDieName(offer.id), detail: type.elements.join(' & ') }
    }
  }
}

const ownedCount = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((n, c) => n + c, 0)

/**
 * Why a dragon offer might matter now: a force of more than 24 health brings two, and a
 * run fields only the dragons it owns. Null when it adds nothing the run is short of.
 */
export function dragonNote(run: RunState): string | null {
  const owned = ownedCount(run.collection.dragons)
  const most = dragonCount(ACT_SIZE[3])
  if (owned >= most) return `You own ${owned}; a force brings at most ${most}.`
  return `You own ${owned}. A force over 24 health brings ${most}, and fields only the dragons it owns.`
}

/** What one finished encounter came to, in a line. */
export function outcomeText(entry: HistoryEntry): string {
  const outcome = entry.outcome
  switch (outcome.kind) {
    case 'won':
      return outcome.took === null ? 'won' : `won · took ${offerText(outcome.took, null).name}`
    case 'lost':
      return 'lost'
    case 'upgrade':
      return `upgraded ${unitType(outcome.from).name} to ${unitType(outcome.to).name}`
    case 'transform':
      return `transformed ${unitType(outcome.from).name} into ${unitType(outcome.to).name}`
    case 'skip':
      return 'walked on'
  }
}

/** "II · 5": where an entry stood, for a list. */
export const entryWhere = (entry: HistoryEntry): string => `${ROMAN[entry.act]} · ${entry.encounter + 1}`

export interface RunStats {
  readonly battlesWon: number
  readonly events: number
  readonly poolHealth: number
  readonly dragons: number
  readonly fielded: number
}

export function runStats(run: RunState): RunStats {
  return {
    battlesWon: run.history.filter((h) => h.outcome.kind === 'won').length,
    events: run.history.filter((h) => h.outcome.kind !== 'won' && h.outcome.kind !== 'lost').length,
    poolHealth: Object.entries(run.collection.units).reduce((n, [id, c]) => n + unitType(id).health * c, 0),
    dragons: ownedCount(run.collection.dragons),
    fielded: forceHealth(run.force),
  }
}

/** What the start screen says about a saved run: a run to continue, a finished one, or why
 *  one was discarded. */
export type SavedRunView =
  | { readonly kind: 'none' }
  | { readonly kind: 'discarded'; readonly message: string }
  | { readonly kind: 'playing'; readonly title: string; readonly detail: string }
  | { readonly kind: 'over'; readonly title: string }

export function savedRunView(load: RunLoad, now: Date = new Date()): SavedRunView {
  switch (load.kind) {
    case 'none':
      return { kind: 'none' }
    case 'outdated':
      return { kind: 'discarded', message: `A run saved by an older version of the app could not be continued, and was discarded.` }
    case 'unreadable':
      return { kind: 'discarded', message: `A saved run could not be read (${load.reason}), and was discarded.` }
    case 'ok': {
      const run = load.run
      if (run.status !== 'playing') return { kind: 'over', title: `${runName(run)} ${run.status === 'won' ? 'was won' : 'was lost'}` }
      const next = run.current === null ? '' : ` · next: ${run.current.name}`
      return {
        kind: 'playing',
        title: `${runName(run)} · ${runWhere(run)}`,
        detail: `${forceHealth(run.force)} of ${ACT_SIZE[run.act]} health fielded${next} · saved ${savedWhen(load.savedAt, now)}`,
      }
    }
  }
}

/** "today at 14:02", "on 3 Oct": when a save was written, as a person reads it. */
export function savedWhen(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'some time ago'
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  if (at.toDateString() === now.toDateString()) return `today at ${time}`
  return `on ${at.getDate()} ${at.toLocaleString('en', { month: 'short' })}`
}
