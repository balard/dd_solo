/**
 * What the start screen has to decide, without a DOM.
 *
 * The screen itself is a few dropdowns, a text field and some buttons; everything that
 * can be got wrong -- which forces may face each other, what an empty seed box means
 * -- is here instead, for the same reason `prompts.ts` holds the rules about which
 * dice are selectable: it is testable, and this project has no jsdom.
 *
 * **A side is a preset, a force kept in the army builder, or -- for the opponent -- a
 * random force** (v2 Phase 4c). Every one of them becomes a `BuiltForce` here, and two
 * presets still become the `named` spec they always were, so a preset game's record
 * reads exactly as it did before the builder existed.
 *
 * The one rule with teeth is health parity, and it lives here rather than in the
 * engine. `setupGame` stopped caring in v2 Phase 2 -- a 12-health force may face a
 * 24-health one on purpose, which v3's encounters will -- so whether an unequal pairing
 * is a choice or a slip is a question only the screen that made it can answer. This one
 * answers it by asking: unequal is refused until the player says it is on purpose.
 */
import { DEFAULT_OPPONENT, OPPONENT_NAMES, type OpponentName } from '../../ai/opponents'
import { FULL_COLLECTION, collectionNamed } from '../../data/collections'
import { PLAYABLE_SPECIES } from '../../engine/playable'
import { PRESETS, preset, presetHealth, PRESET_ARMY_NAMES } from '../../data/presets'
import { builtForceHealth, rollForce, type BuiltForce, type ForcePool } from '../../engine/force'
import { forceProblems } from '../../engine/forceProblems'
import { rngFrom } from '../../engine/rng'
import type { ForceSpec, SetupOptions } from '../../engine/setup'
import { V1_RULES, type PlayerId } from '../../engine/types'

import type { SavedForce } from './forceStore'

export interface PresetChoice {
  readonly id: string
  readonly name: string
  /** The species id, for the caller to render however it renders species. */
  readonly species: string
  readonly health: number
  /** Dice per starting army, home first: `3 / 2 / 1`. */
  readonly split: string
}

/** A group of forces that can face each other. Health is what decides that, so it
 *  is what the groups are, and an `<optgroup>` per group makes the legal pairings
 *  visible before anything is clicked. */
export interface ChoiceGroup {
  readonly health: number
  readonly choices: readonly PresetChoice[]
}

function choiceOf(id: string): PresetChoice {
  const p = preset(id)
  return {
    id,
    name: p.name,
    species: p.species,
    health: presetHealth(p),
    split: PRESET_ARMY_NAMES.map((army) => p.armies[army].length).join(' / '),
  }
}

/** Species whose solo-monster fixtures (24 health) are kept off the start screen to
 *  keep it short. They stay in `FORCE_SETS`, so `?forces=treefolk_satyr` and the fuzzes
 *  still reach them. */
const HIDDEN_FIXTURE_SPECIES: readonly string[] = ['treefolk', 'firewalkers', 'coral_elves']

function isHiddenFixture(id: string): boolean {
  return HIDDEN_FIXTURE_SPECIES.some((s) => id.startsWith(`${s}_`)) &&
    !id.endsWith('_starter') && !id.endsWith('_bestiary')
}

/** Every hand-authored force the screen offers, lightest first. */
export function presetChoices(): readonly PresetChoice[] {
  return PRESETS.filter((p) => !isHiddenFixture(p.id)).map((p) => choiceOf(p.id)).sort(
    (a, b) =>
      a.health - b.health || a.species.localeCompare(b.species) || a.name.localeCompare(b.name),
  )
}

export function choiceGroups(): readonly ChoiceGroup[] {
  const groups: ChoiceGroup[] = []
  for (const choice of presetChoices()) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.health === choice.health) {
      groups[groups.length - 1] = { health: last.health, choices: [...last.choices, choice] }
    } else {
      groups.push({ health: choice.health, choices: [choice] })
    }
  }
  return groups
}

/** One opponent on the start screen: what it is called, and what it will do. */
export interface OpponentChoice {
  readonly id: OpponentName
  readonly name: string
  readonly note: string
}

const OPPONENT_TEXT: Readonly<Record<OpponentName, Omit<OpponentChoice, 'id'>>> = {
  greedy: {
    name: 'Greedy',
    note: 'Marches every turn: maneuvers, attacks, casts spells, summons dragons and promotes its dead.',
  },
  passive: {
    name: 'Passive',
    note: 'Starts nothing. It answers what it must, contests and counter-attacks, and never marches -- for learning the rules.',
  },
}

/**
 * The opponents the screen offers, the default first.
 *
 * Built from `OPPONENTS` rather than listed, and the text table is a `Record` over
 * its names -- so an opponent added to the registry is a compile error here until it
 * has words, and cannot reach the screen described as nothing.
 */
export function opponentChoices(): readonly OpponentChoice[] {
  return [...OPPONENT_NAMES]
    .sort((a, b) => Number(b === DEFAULT_OPPONENT) - Number(a === DEFAULT_OPPONENT))
    .map((id) => ({ id, ...OPPONENT_TEXT[id] }))
}

export type SeedChoice =
  | { readonly kind: 'random' }
  | { readonly kind: 'fixed'; readonly seed: number }
  | { readonly kind: 'bad'; readonly problem: string }

/**
 * An empty box means "roll one", which is the same rule `parseGameRequest` applies to
 * `?seed=`: `Number('')` is 0, a perfectly legal seed and a silently different game
 * from the one an empty box was asking for.
 *
 * Anything else that is not a seed is *reported*. Rolling a random game because the
 * seed was mistyped is the one outcome that wastes the run you were trying to repeat.
 */
export function readSeed(text: string): SeedChoice {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'random' }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { kind: 'bad', problem: `a seed is a whole number, 0 or more -- "${trimmed}" is not` }
  }
  return { kind: 'fixed', seed: parsed }
}

export type SetupChoice =
  | {
      readonly kind: 'ok'
      readonly setup: SetupOptions
      /** Each side's health, when both are known: the screen asks "on purpose?" only
       *  while they differ. Absent for a game rolled whole. */
      readonly health?: Readonly<Record<PlayerId, number>>
    }
  | { readonly kind: 'problem'; readonly problem: string; readonly health?: Readonly<Record<PlayerId, number>> }

/** The seed box resolved to a number, with "empty means roll one" spent. */
type ResolvedSeed =
  | { readonly kind: 'fixed'; readonly seed: number }
  | { readonly kind: 'bad'; readonly problem: string }

function withSeed(seedText: string, randomSeed: number): ResolvedSeed {
  const seed = readSeed(seedText)
  return seed.kind === 'random' ? { kind: 'fixed', seed: randomSeed } : seed
}

// --- the two sides (v2 Phase 4c) ------------------------------------------------------

/** A side either player may bring. */
export type SideChoice = { readonly kind: 'preset'; readonly id: string } | { readonly kind: 'kept'; readonly id: string }

/** The opponent's side may also be rolled: at your size, or at a size chosen. */
export type OpponentSide =
  | SideChoice
  | { readonly kind: 'random'; readonly size: 'same' | number; readonly pool: ForcePool }

/** A side as a `<select>` value: `preset:<id>`, `kept:<id>`, or `random`. */
export function sideValue(side: SideChoice | { readonly kind: 'random' }): string {
  return side.kind === 'random' ? 'random' : `${side.kind}:${side.id}`
}

export function parseSideValue(value: string): SideChoice | { readonly kind: 'random' } | null {
  if (value === 'random') return { kind: 'random' }
  const colon = value.indexOf(':')
  if (colon < 0) return null
  const kind = value.slice(0, colon)
  const id = value.slice(colon + 1)
  if (id === '') return null
  return kind === 'preset' || kind === 'kept' ? { kind, id } : null
}

export interface SideOption {
  readonly value: string
  readonly label: string
  /** A kept force with something to fix: listed, so it is not mysteriously missing,
   *  but not pickable. */
  readonly disabled: boolean
}

export interface SideOptionGroup {
  readonly label: string
  readonly options: readonly SideOption[]
}

/** The problems a kept force has against the collection and cap it was built for -- the
 *  same question the builder asks, so the two screens cannot disagree about "ready". */
function keptProblems(entry: SavedForce): number {
  return forceProblems(collectionNamed(entry.collection) ?? FULL_COLLECTION, entry.cap, entry.force).length
}

/**
 * What a side's picker offers, in groups: a random force (the opponent's only), the
 * forces kept in the builder, then the presets by health. The presets are grouped by
 * health because health is what pairs, so the legal pairings are visible before anything
 * is clicked.
 */
export function sideOptionGroups(kept: readonly SavedForce[], opponent: boolean): readonly SideOptionGroup[] {
  const groups: SideOptionGroup[] = []
  if (opponent) {
    groups.push({ label: 'Rolled', options: [{ value: 'random', label: 'A random force', disabled: false }] })
  }
  if (kept.length > 0) {
    groups.push({
      label: 'Kept in the army builder',
      options: kept.map((entry) => {
        const count = keptProblems(entry)
        return {
          value: sideValue({ kind: 'kept', id: entry.id }),
          label: count === 0 ? entry.name : `${entry.name} (${count} to fix in the builder)`,
          disabled: count > 0,
        }
      }),
    })
  }
  for (const group of choiceGroups()) {
    groups.push({
      label: `${group.health} health`,
      options: group.choices.map((c) => ({
        value: sideValue({ kind: 'preset', id: c.id }),
        label: c.name,
        disabled: false,
      })),
    })
  }
  return groups
}

/** A side made concrete: the force, and the preset it came from, if any -- two presets
 *  are still a `named` game. */
type ResolvedSide =
  | { readonly kind: 'ok'; readonly force: BuiltForce; readonly presetId: string | null }
  | { readonly kind: 'problem'; readonly problem: string }

function resolveSide(side: SideChoice, kept: readonly SavedForce[], whose: string): ResolvedSide {
  if (side.kind === 'preset') {
    const found = PRESETS.find((p) => p.id === side.id)
    if (found === undefined) return { kind: 'problem', problem: `${whose} force, ${side.id}, is not a preset` }
    return { kind: 'ok', force: { armies: found.armies }, presetId: found.id }
  }
  const entry = kept.find((f) => f.id === side.id)
  if (entry === undefined) return { kind: 'problem', problem: `${whose} kept force is no longer kept` }
  const count = keptProblems(entry)
  if (count > 0) {
    return {
      kind: 'problem',
      problem: `${whose} force, ${entry.name}, has ${count} thing${count === 1 ? '' : 's'} to fix in the army builder`,
    }
  }
  return { kind: 'ok', force: entry.force, presetId: null }
}

/**
 * The salt that turns the game's seed into the opponent's force draw.
 *
 * A random opponent is rolled here, before `setupGame`, and handed to it as a built
 * force, so the record carries it whole and replays without this function. It is drawn
 * from the game's seed so "the same seed and the same forces" is still the same game --
 * but from its own stream, not the one setup draws the roll-off from, or the two would
 * read the same numbers for unrelated purposes.
 */
const OPPONENT_SALT = 0x0f0e_5eed

/** The opponent's random force for this seed, or why there is none. */
export function rollOpponent(
  seed: number,
  health: number,
  pool: ForcePool,
): { readonly force: BuiltForce } | { readonly problem: string } {
  try {
    const [force] = rollForce(health, pool, rngFrom((seed ^ OPPONENT_SALT) >>> 0))
    return { force }
  } catch (error) {
    return { problem: `no random force of ${health} health could be rolled: ${(error as Error).message}` }
  }
}

/** Everything the start screen collects for a game of chosen forces. */
export interface NewGameRequest {
  readonly p1: SideChoice
  readonly p2: OpponentSide
  /** The player has said an unequal pairing is on purpose. */
  readonly unequal: boolean
  readonly seedText: string
}

/**
 * The setup for a game of chosen forces, or why there is none.
 *
 * Two presets are still a `named` spec, so a preset game's record is the one it always
 * was. Anything else is `built`, both sides whole. `ruleSet` is stated rather than left
 * to `setupGame`'s `V0_RULES` default, so the record says which rules it was played under.
 */
export function newGameSetup(
  request: NewGameRequest,
  kept: readonly SavedForce[],
  randomSeed: number,
): SetupChoice {
  const seed = withSeed(request.seedText, randomSeed)
  if (seed.kind === 'bad') return { kind: 'problem', problem: seed.problem }

  const p1 = resolveSide(request.p1, kept, 'your')
  if (p1.kind === 'problem') return p1
  const p1Health = builtForceHealth(p1.force)

  let p2: { readonly force: BuiltForce; readonly presetId: string | null }
  if (request.p2.kind === 'random') {
    const health = request.p2.size === 'same' ? p1Health : request.p2.size
    const rolled = rollOpponent(seed.seed, health, request.p2.pool)
    if ('problem' in rolled) return { kind: 'problem', problem: rolled.problem }
    p2 = { force: rolled.force, presetId: null }
  } else {
    const resolved = resolveSide(request.p2, kept, "the opponent's")
    if (resolved.kind === 'problem') return resolved
    p2 = resolved
  }

  const health = { p1: p1Health, p2: builtForceHealth(p2.force) }
  if (health.p1 !== health.p2 && !request.unequal) {
    return {
      kind: 'problem',
      problem:
        `those forces are ${health.p1} and ${health.p2} health; ` +
        'say the sizes differ on purpose to play it anyway',
      health,
    }
  }

  const forces: ForceSpec =
    p1.presetId !== null && p2.presetId !== null
      ? { kind: 'named', forces: { p1: p1.presetId, p2: p2.presetId } }
      : { kind: 'built', forces: { p1: p1.force, p2: p2.force } }
  return { kind: 'ok', setup: { seed: seed.seed, forces, ruleSet: V1_RULES }, health }
}

/** The pools a random opponent may be drawn from: every playable species together, or one. */
export function poolChoices(): readonly { readonly value: string; readonly label: string; readonly pool: ForcePool }[] {
  return [
    { value: 'mixed', label: 'Every species, mixed', pool: { kind: 'mixed' } },
    ...PLAYABLE_SPECIES.map((s) => ({
      value: s.id,
      label: `${s.name} only`,
      pool: { kind: 'species', species: s.id } as const,
    })),
  ]
}

/** The sizes a random opponent may be asked for besides yours: the builder's caps. */
export const RANDOM_SIZES: readonly number[] = [12, 24, 36]

/** Both sides rolled from the seed, which is what an ordinary game is. */
export function randomGameSetup(seedText: string, randomSeed: number): SetupChoice {
  const seed = withSeed(seedText, randomSeed)
  if (seed.kind === 'bad') return { kind: 'problem', problem: seed.problem }
  return {
    kind: 'ok',
    setup: { seed: seed.seed, forces: { kind: 'random' }, ruleSet: V1_RULES },
  }
}
