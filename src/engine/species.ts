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
 * This file holds the two facts every one of those asks -- does this *die's* species
 * have the ability, and does this terrain carry the element it keys on -- and the
 * rules text both clients show.
 *
 * **Per die, not per player** (v2 Phase 1). Every ability here names units -- "Treefolk
 * units", "Firewalker units", "Firewalkers may count save results" -- so in a mixed army
 * only the dice of that species act, and a Treefolk save beside a Firewalker one stays
 * a save. v1 asked about the player, which was the same set of dice while a force was
 * one species. It holds no ability's behaviour: that lives at the
 * seam, the same split `sai.ts` keeps between a handler and the step that consumes it.
 */
import { terrainDie, terrainType, unitType } from '../data/load'
import type { Element } from '../data/types'

import { forceSize, type ArmyRef, type GameState, type PlayerId, type RuleSet, type UnitInstance } from './types'

export type AbilityName =
  | 'Rapid Growth'
  | 'Replanting'
  | 'Air Flight'
  | 'Flaming Shields'
  | 'Coastal Dodge'
  | 'Defensive Volley'
  | 'Mountain Mastery'
  | 'Dwarven Might'
  | 'Swamp Mastery'
  | 'Foul Stench'

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
  coral_elves: ['Coastal Dodge', 'Defensive Volley'],
  dwarves: ['Mountain Mastery', 'Dwarven Might'],
  goblins: ['Swamp Mastery', 'Foul Stench'],
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
  'Coastal Dodge':
    'When at a terrain that contains water, Coral Elves may count maneuver results as if ' +
    'they were save results.',
  'Defensive Volley':
    'When at a terrain that contains air, Coral Elves units may counter-attack against a ' +
    'missile action. Follow the same process used for a regular melee counter-attack, ' +
    'using missile results instead of melee results.',
  'Mountain Mastery':
    'When at a terrain that contains earth, Dwarves may count melee results as if they were ' +
    'maneuver results.',
  'Dwarven Might':
    'When at a terrain that contains fire, Dwarves may count save results as if they were ' +
    'melee results when rolling for a counter-attack.',
  'Swamp Mastery':
    'When at a terrain that contains earth, Goblins may count melee results as if they ' +
    'were maneuver results.',
  'Foul Stench':
    'When an army containing Goblins takes a melee action, the opposing player must select ' +
    'a number of their units after they have resolved their save roll. The selected units ' +
    'cannot perform a counter-attack during this melee action. The number of units that ' +
    "must be selected in this way is equal to the number of Goblin units in the Goblin " +
    "player's DUA, up to a maximum of three for every 24 health of force size.",
}

/** Whether a species has `ability` -- the table alone, with no ruleset in it. */
export function speciesHasAbility(speciesId: string, ability: AbilityName): boolean {
  return (SPECIES_ABILITIES[speciesId] ?? []).includes(ability)
}

/**
 * Whether this die has `ability` in the rules being played.
 *
 * Asks the ruleset first, so nothing behind it -- and in particular no die -- is ever
 * reached under `V0_RULES`. Takes the ruleset rather than the state because a unit's
 * species is a fact about its type, and nothing else about the game can change it.
 */
export function unitHasAbility(ruleSet: RuleSet, unit: UnitInstance, ability: AbilityName): boolean {
  if (!ruleSet.speciesAbilities) return false
  return speciesHasAbility(unitType(unit.typeId).species, ability)
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

/**
 * The cap on an ability that counts a player's DUA (v2 Phase 7b): Foul Stench (7d) and
 * Cursed Bullets (Phase 8). p. 21: "the limit stated is per 24 points of total force
 * size, or part thereof" -- so "three" is 3 up to 24, 6 from 25 to 48, and a 30-health
 * starter game already allows 6.
 *
 * The force is the ability holder's own (`forceSize`, every unit it owns, dead and buried
 * included), which is the reading PLAN-V2.md settled for unequal sides: each player's
 * limit follows what that player brought.
 */
export function duaCap(state: GameState, player: PlayerId, per: number): number {
  return capPer24(forceSize(state, player), per)
}

/** `duaCap`'s arithmetic, apart from a state: `per` for every 24 or part of 24. */
export function capPer24(size: number, per: number): number {
  return per * Math.ceil(size / 24)
}
