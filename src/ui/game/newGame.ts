/**
 * What the start screen has to decide, without a DOM.
 *
 * The screen itself is two dropdowns, a text field and two buttons; everything that
 * can be got wrong -- which forces may face each other, what an empty seed box means
 * -- is here instead, for the same reason `prompts.ts` holds the rules about which
 * dice are selectable: it is testable, and this project has no jsdom.
 *
 * The one rule with teeth is health parity. `setupGame` throws when the two sides
 * bring different totals, and a throw out of a click handler is a blank page, so the
 * pairing is checked here and the Start button reports it instead.
 */
import { PRESETS, preset, presetHealth, PRESET_ARMY_NAMES } from '../../data/presets'
import type { SetupOptions } from '../../engine/setup'
import { FULL_RULES } from '../../engine/types'

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

/** Every hand-authored force, lightest first -- which puts the monster fixtures at
 *  the top, where the reason this screen exists wants them. */
export function presetChoices(): readonly PresetChoice[] {
  return PRESETS.map((p) => choiceOf(p.id)).sort(
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
  | { readonly kind: 'ok'; readonly setup: SetupOptions }
  | { readonly kind: 'problem'; readonly problem: string }

/** The seed box resolved to a number, with "empty means roll one" spent. */
type ResolvedSeed =
  | { readonly kind: 'fixed'; readonly seed: number }
  | { readonly kind: 'bad'; readonly problem: string }

function withSeed(seedText: string, randomSeed: number): ResolvedSeed {
  const seed = readSeed(seedText)
  return seed.kind === 'random' ? { kind: 'fixed', seed: randomSeed } : seed
}

/** Named on both sides. `ruleSet` is stated rather than left to `setupGame`'s
 *  `V0_RULES` default, so the record says which rules it was played under. */
export function newGameSetup(
  p1: string,
  p2: string,
  seedText: string,
  randomSeed: number,
): SetupChoice {
  const seed = withSeed(seedText, randomSeed)
  if (seed.kind === 'bad') return { kind: 'problem', problem: seed.problem }

  const health = { p1: presetHealth(preset(p1)), p2: presetHealth(preset(p2)) }
  if (health.p1 !== health.p2) {
    return {
      kind: 'problem',
      problem:
        `those forces are ${health.p1} and ${health.p2} health; ` +
        'both sides bring the same, or the game is unfair before it starts',
    }
  }

  return {
    kind: 'ok',
    setup: { seed: seed.seed, forces: { kind: 'named', forces: { p1, p2 } }, ruleSet: FULL_RULES },
  }
}

/** Both sides rolled from the seed, which is what an ordinary game is. */
export function randomGameSetup(seedText: string, randomSeed: number): SetupChoice {
  const seed = withSeed(seedText, randomSeed)
  if (seed.kind === 'bad') return { kind: 'problem', problem: seed.problem }
  return {
    kind: 'ok',
    setup: { seed: seed.seed, forces: { kind: 'random' }, ruleSet: FULL_RULES },
  }
}
