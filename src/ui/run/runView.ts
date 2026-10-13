/**
 * What the run screens have to decide, without a DOM (v3 Phase 4b) -- `prompts.ts`'s
 * arrangement for the game: a component shows these and decides none of them.
 */
import { dragonDie, dragonName, terrainDie, terrainDieName, terrainType, unitType } from '../../data/load'
import { dragonCount } from '../../engine/force'
import { forceHealth } from '../../engine/forceProblems'
import { eventEffect } from '../../run/reduce'
import {
  ACTS,
  ACT_SIZE,
  actLength,
  type Act,
  type Encounter,
  type Grant,
  type HistoryEntry,
  type Offer,
  type RunState,
} from '../../run/types'
import type { RunLoad } from '../../run/save'

import { describe } from '../game/DiceGrid'
import { speciesInfo } from '../game/Elements'

export const ROMAN: Readonly<Record<Act, string>> = { 1: 'I', 2: 'II', 3: 'III' }

/** One encounter's place on the act strip. Ahead is never a kind: the schedule is drawn
 *  when the act starts (v3 Phase 6), but the strip keeps what is coming a surprise. */
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
    const slots: SlotState[] = Array.from({ length: actLength(act) }, () => 'ahead')
    for (const entry of run.history) if (entry.act === act) slots[entry.encounter] = slotOf(entry)
    if (run.status === 'playing' && run.act === act) slots[run.encounter] = 'here'
    const state = act < run.act || (run.status === 'won' && act === run.act) ? 'done' : act === run.act ? 'now' : 'ahead'
    return { act, cap: ACT_SIZE[act], state, slots }
  })
}

/** "Act II · 5 of 6". */
export const runWhere = (run: RunState): string =>
  `Act ${ROMAN[run.act]} · ${run.encounter + 1} of ${actLength(run.act)}`

/** "II·5": the same, where a header has one word of room (4a: upright, and sideways). */
export const runWhereShort = (run: RunState): string => `${ROMAN[run.act]}·${run.encounter + 1}`

/**
 * What Concede asks in a run's battle (v3 Phase 4d): that a lost battle ends the run, and
 * that Leave run is the way to stop for now.
 */
export function concedeAsk(run: RunState): { readonly question: string; readonly detail: string } {
  const name = run.current?.name ?? 'this battle'
  return {
    question: `Concede ${name}?`,
    detail:
      `A lost battle ends the run: ${runName(run).replace(/^A /, 'your ')} stops at ${runWhere(run)}. ` +
      `To stop for now and come back to this battle's start, use Leave run instead.`,
  }
}

/**
 * Where a battle's game-over card leads (v3 Phase 4d), read off the run *after* the
 * result was recorded: to the reward, or to the run's end, with a line saying which. Null
 * while the run still waits on the battle, which is the frame between the last blow and
 * the result reaching the run.
 */
export function battleOutcome(run: RunState): { readonly label: string; readonly note: string | null } | null {
  if (run.pending.kind === 'reward') return { label: 'Pick your reward', note: 'Pick one offer: it goes to your pool.' }
  if (run.status === 'won') return { label: 'See the run', note: 'That was the last battle: the run is won.' }
  if (run.status === 'lost') return { label: 'See the run', note: `The run ends at ${runWhere(run)}.` }
  return null
}

export const speciesName = (id: string): string => speciesInfo(id)?.name ?? id

/** "A Treefolk run", or "A run" before a race is picked. */
export const runName = (run: RunState): string => (run.race === null ? 'A run' : `A ${speciesName(run.race)} run`)

interface OfferText {
  readonly kind: string
  readonly name: string
  readonly detail: string
}

/** How one die given reads: what kind it is, its name with its count, and a line about it. */
export function grantText(grant: Grant, race: string | null): OfferText {
  const times = grant.count > 1 ? ` ×${grant.count}` : ''
  switch (grant.kind) {
    case 'unit': {
      const type = unitType(grant.id)
      const yours = race !== null && type.species === race
      return {
        kind: yours ? 'Your race' : speciesName(type.species),
        name: `${type.name}${times}`,
        detail: `${speciesName(type.species)} · ${type.health * grant.count} health · ${describe(type).replace(`${type.name} — `, '')}`,
      }
    }
    case 'dragon': {
      const die = dragonDie(grant.id)
      return { kind: 'Dragon', name: `${dragonName(grant.id)}${times}`, detail: `${die.element} · ${die.form}` }
    }
    case 'terrain': {
      const type = terrainType(terrainDie(grant.id).type)
      return { kind: 'Terrain', name: `${terrainDieName(grant.id)}${times}`, detail: type.elements.join(' & ') }
    }
  }
}

/** How one offer reads (v3 Phase 6: an offer can give two dice): each die's words, joined. */
export function offerText(offer: Offer, race: string | null): OfferText {
  const parts = offer.grants.map((g) => grantText(g, race))
  return {
    kind: parts.map((p) => p.kind).join(' + '),
    name: parts.map((p) => p.name).join(' + '),
    detail: parts.map((p) => p.detail).join(' · '),
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
      return `took ${unitType(outcome.small).name}, transformed ${unitType(outcome.from).name} into ${unitType(outcome.to).name}`
    case 'small':
      return `took ${unitType(outcome.took).name}`
    case 'boon':
      return `took ${offerText(outcome.took, null).name}`
  }
}

/**
 * The dice won since the last battle (v3 Phase 4c), for the force screen to light: that
 * battle's reward, and what every event since turned a die into. Walking back from the
 * newest entry, the first battle won is where it stops; a run's opening has nothing new.
 */
export function freshDice(run: RunState): { readonly units: ReadonlySet<string>; readonly dragons: ReadonlySet<string> } {
  const units = new Set<string>()
  const dragons = new Set<string>()
  for (const entry of [...run.history].reverse()) {
    const outcome = entry.outcome
    const add = (offer: Offer | null) => {
      for (const grant of offer?.grants ?? []) {
        if (grant.kind === 'unit') units.add(grant.id)
        if (grant.kind === 'dragon') dragons.add(grant.id)
      }
    }
    if (outcome.kind === 'upgrade') units.add(outcome.to)
    if (outcome.kind === 'transform') units.add(outcome.to).add(outcome.small)
    if (outcome.kind === 'small') units.add(outcome.took)
    if (outcome.kind === 'boon') add(outcome.took)
    if (outcome.kind === 'won') {
      add(outcome.took)
      break
    }
    if (outcome.kind === 'lost') break
  }
  return { units, dragons }
}

/** What an event's dialog says it did (playtest, 2026-10-09). */
export interface EventResult {
  readonly kind: 'upgrade' | 'transform'
  readonly from: string
  readonly to: string
  /** The small die that came with a transform. */
  readonly small: string | null
  /** "Oak became an Oak Lord." */
  readonly title: string
  /** What happened to the force, in a sentence or two. */
  readonly force: string
  /** Where the run goes from here: "Next: Ember cult, a battle." */
  readonly next: string
}

const ENCOUNTER_WORD: Readonly<Record<Encounter['kind'], string>> = { battle: 'a battle', event: 'an event', boon: 'a boon' }

const article = (name: string): string => (/^[AEIOU]/i.test(name) ? `an ${name}` : `a ${name}`)
const ARMY_WORD: Readonly<Record<string, string>> = { home: 'Home army', campaign: 'Campaign army', horde: 'Horde' }

/**
 * What an upgrade or a transform did, read off the run before it and after it: the die it
 * changed into (a transform's is random, so only `after` knows), what that did to the
 * force (`eventEffect`, the reducer's own rule, asked of `before`), and what comes next.
 * Null when `after` did not just finish an upgrade or a transform.
 */
export function eventResult(before: RunState, after: RunState): EventResult | null {
  if (after.history.length !== before.history.length + 1) return null
  const outcome = after.history[after.history.length - 1]?.outcome
  if (outcome === undefined || (outcome.kind !== 'upgrade' && outcome.kind !== 'transform')) return null
  const from = unitType(outcome.from).name
  const to = unitType(outcome.to).name
  const effect = eventEffect(before, outcome.from, outcome.to, outcome.kind)
  const cap = ACT_SIZE[before.act]
  const where = effect.army === null ? 'force' : (ARMY_WORD[effect.army] ?? effect.army)
  let force: string
  switch (effect.effect) {
    case 'pool':
      force = `It was a spare ${from}, so your force did not change.`
      break
    case 'in_place':
      force = `It took the ${from}'s place in your ${where}: ${forceHealth(effect.force)} of ${cap} health.`
      break
    case 'benched': {
      const emptied = effect.army !== null && effect.force.armies[effect.army].length === 0
      force =
        `It did not fit where the ${from} stood, so it left your ${where} and waits in your pool.` +
        (emptied ? ` That leaves your ${where} empty: fill it before you fight.` : ` Field it before the next battle.`)
      break
    }
  }
  const next =
    after.status === 'won'
      ? 'That was the last encounter: the run is won.'
      : after.current === null
        ? ''
        : after.act !== before.act
          ? `Act ${ROMAN[after.act]} begins, with a cap of ${ACT_SIZE[after.act]}. Next: ${after.current.name}, a battle.`
          : `Next: ${after.current.name}, ${ENCOUNTER_WORD[after.current.kind]}.`
  return {
    kind: outcome.kind,
    from: outcome.from,
    to: outcome.to,
    small: outcome.kind === 'transform' ? outcome.small : null,
    title: `${from} became ${article(to)}.`,
    force,
    next,
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
      // A run resting on its reward has beaten the encounter in hand (4d records the win
      // the moment it lands), so that is not what comes next.
      const next =
        run.current === null
          ? ''
          : run.pending.kind === 'reward'
            ? ` · ${run.current.name} beaten, a reward to pick`
            : ` · next: ${run.current.name}`
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
