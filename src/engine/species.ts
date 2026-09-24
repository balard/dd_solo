/**
 * Species abilities (full rules p. 21), v1 Phase 8.
 *
 * Each species brings two. Treefolk and Firewalkers -- the whole of this plan's scope --
 * bring four between them, and **none of the four acts in the Species Abilities Phase**
 * that the turn now has: each fires somewhere the engine already had a seam.
 *
 *   Rapid Growth     a counter-maneuver roll           `applyContest` in `turn.ts`
 *   Replanting       a death                           `killUnits` in `death.ts`
 *   Air Flight       the Retreat Step                  `applyRetreat` in `turn.ts`
 *   Flaming Shields  a melee roll, as a "counts as"    `armyRoll` and `resolveFaces`
 *
 * This file holds the two facts every one of those asks -- does this player's species
 * have the ability, and does this terrain carry the element it keys on -- and the
 * rules text both clients show. It holds no ability's behaviour: that lives at the
 * seam, the same split `sai.ts` keeps between a handler and the step that consumes it.
 */
import { terrainDie, terrainType } from '../data/load'
import type { Element } from '../data/types'

import { speciesOf, type ArmyRef, type GameState, type PlayerId } from './types'

export type AbilityName = 'Rapid Growth' | 'Replanting' | 'Air Flight' | 'Flaming Shields'

/**
 * Which abilities each species has.
 *
 * Keyed by the species id in `data/`. `species.test.ts` asserts every species in the
 * data has an entry, so a species added later fails there rather than quietly playing
 * with none -- an empty list is a claim, not a default.
 */
export const SPECIES_ABILITIES: Readonly<Record<string, readonly AbilityName[]>> = {
  treefolk: ['Rapid Growth', 'Replanting'],
  firewalkers: ['Air Flight', 'Flaming Shields'],
}

/** The rule as the full rules state it, for both clients. Beside the table for the
 *  reason `SAI_TEXT` sits beside the handlers. */
export const ABILITY_TEXT: Readonly<Record<AbilityName, string>> = {
  'Rapid Growth':
    'When at a terrain that contains earth, Treefolk units that do not roll an SAI result ' +
    'may be re-rolled once when making a counter-maneuver. The previous results are ignored. ' +
    'Any units you wish to re-roll in this way must be selected and re-rolled together.',
  Replanting:
    'When at a terrain that contains water, Treefolk units that are killed should be rolled ' +
    'before being moved to the DUA. Any units that roll an ID icon are not killed and are ' +
    'instead moved to your Reserve Area.',
  'Air Flight':
    'During the Retreat Step of the Reserves Phase, Firewalker units may move from any ' +
    'terrain that contains air to any other terrain that contains air and where you have at ' +
    'least one Firewalker unit.',
  'Flaming Shields':
    'When at a terrain that contains fire, Firewalkers may count save results as if they ' +
    'were melee results. Flaming Shields does not apply when making a counter-attack.',
}

/**
 * Whether `player` has `ability` in the rules being played.
 *
 * Asks the ruleset first, so nothing behind it -- and in particular no die -- is ever
 * reached under `V0_RULES`. A force is one species, so "Treefolk units" in an
 * ability's text is simply "that player's units".
 */
export function hasAbility(state: GameState, player: PlayerId, ability: AbilityName): boolean {
  if (!state.ruleSet.speciesAbilities) return false
  return (SPECIES_ABILITIES[speciesOf(state, player)] ?? []).includes(ability)
}

/**
 * Whether the terrain an army stands on "contains" an element: the terrain die's type.
 *
 * The Reserve Area holds no terrain and so contains nothing, which is the rule and not
 * a house rule -- every ability keyed on an element is off there. Standing Stones does
 * not widen this: it converts an army's *magic* to the terrain's elements, which says
 * nothing about what the terrain contains.
 */
export function terrainHas(state: GameState, ref: ArmyRef, element: Element): boolean {
  if (ref === 'reserve') return false
  return terrainType(terrainDie(state.terrains[ref].dieId).type).elements.includes(element)
}
