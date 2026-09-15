/**
 * Turns `state.pending` into a sentence and a set of buttons.
 *
 * Pure, and the single place that decides what the game is asking for. The action
 * bar renders whatever this returns, so no component ever tracks its own wizard
 * state or decides what is legal -- the engine already did both.
 */
import { unitType } from '../../data/load'
import type { UnitClass } from '../../data/types'
import { damageOptions } from '../../engine/damage'
import {
  armyAt,
  type GameAction,
  type GameState,
  type Pending,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../../engine/types'

export const SLOT_LABEL: Record<TerrainSlot, string> = {
  p1_home: 'Your home',
  frontier: 'Frontier',
  p2_home: 'Enemy home',
}

/** Slot labels from the perspective of whoever is reading. */
export function slotLabel(slot: TerrainSlot, human: 'p1' | 'p2'): string {
  if (slot === 'frontier') return 'Frontier'
  const isOwn = (slot === 'p1_home') === (human === 'p1')
  return isOwn ? 'Your home' : 'Enemy home'
}

export interface Choice {
  readonly label: string
  readonly action: GameAction
  /** Marks the "do nothing" option so it can be styled as secondary. */
  readonly passive?: boolean
}

export interface Prompt {
  readonly question: string
  readonly choices: readonly Choice[]
  /** Handled by a dedicated surface rather than plain buttons. */
  readonly custom?: 'assign_damage' | 'reinforce' | 'retreat'
}

export function promptFor(pending: Pending, human: 'p1' | 'p2'): Prompt {
  const label = (slot: TerrainSlot) => slotLabel(slot, human)

  switch (pending.kind) {
    case 'choose_march_army':
      return {
        question: 'Which army marches?',
        choices: [
          ...pending.options.map((army) => ({
            label: label(army as TerrainSlot),
            action: { kind: 'choose_march_army', army } as GameAction,
          })),
          { label: 'Skip march', action: { kind: 'choose_march_army', army: null }, passive: true },
        ],
      }

    case 'choose_maneuver':
      return {
        question: `Maneuver the terrain at ${label(pending.slot)}?`,
        choices: [
          { label: 'Maneuver', action: { kind: 'choose_maneuver', maneuver: true } },
          { label: 'No', action: { kind: 'choose_maneuver', maneuver: false }, passive: true },
        ],
      }

    case 'contest_maneuver':
      return {
        // The direction is deliberately unknown here -- that is the whole point of
        // contesting before it is chosen.
        question: `The enemy is maneuvering ${label(pending.slot)}. Contest it?`,
        choices: [
          { label: 'Contest', action: { kind: 'contest_maneuver', contest: true } },
          { label: 'Allow', action: { kind: 'contest_maneuver', contest: false }, passive: true },
        ],
      }

    case 'choose_direction':
      return {
        question: `Turn ${label(pending.slot)} which way?`,
        choices: pending.options.map((direction) => ({
          label: direction === 'up' ? 'Up — closer' : 'Down — further',
          action: { kind: 'choose_direction', direction } as GameAction,
        })),
      }

    case 'choose_action':
      return {
        question:
          pending.legal.length === 0
            ? `No action is available at ${label(pending.slot)}.`
            : `Take an action at ${label(pending.slot)}?`,
        choices: [
          ...pending.legal.map((action) => ({
            label: action[0]!.toUpperCase() + action.slice(1),
            action: { kind: 'choose_action', action } as GameAction,
          })),
          { label: 'No action', action: { kind: 'choose_action', action: null }, passive: true },
        ],
      }

    case 'choose_missile_target':
      return {
        question: 'Fire at which army?',
        choices: pending.options.map((slot) => ({
          label: label(slot),
          action: { kind: 'choose_missile_target', slot } as GameAction,
        })),
      }

    case 'choose_counter_attack':
      return {
        question: 'Counter-attack?',
        choices: [
          { label: 'Counter-attack', action: { kind: 'choose_counter_attack', counter: true } },
          { label: 'Decline', action: { kind: 'choose_counter_attack', counter: false }, passive: true },
        ],
      }

    case 'assign_damage':
      return {
        question: `Take ${pending.damage} damage`,
        choices: [],
        custom: 'assign_damage',
      }

    case 'reinforce':
      return { question: 'Send units from reserve?', choices: [], custom: 'reinforce' }

    case 'retreat':
      return { question: 'Pull units back to reserve?', choices: [], custom: 'retreat' }
  }
}

/**
 * Everything the damage sheet needs to render and to gate its confirm button.
 *
 * Pure, so the rule that matters -- you may not confirm a selection that absorbs
 * less than it could -- is testable without a DOM. The component renders this and
 * decides nothing.
 */
export interface DamageSelection {
  /** Health of the units currently selected. */
  readonly absorbed: number
  /** Health that must be lost: the maximum this damage can actually kill. */
  readonly required: number
  /** True only when the selection is exactly maximal. */
  readonly ready: boolean
  /** A legal answer, for the auto button. */
  readonly suggestion: readonly UnitId[]
}

export function damageSelection(
  state: GameState,
  pending: Extract<Pending, { kind: 'assign_damage' }>,
  selection: ReadonlySet<UnitId>,
): DamageSelection {
  const army = armyAt(state, pending.player, pending.slot)
  const { required, suggestion } = damageOptions(army, pending.damage)

  const absorbed = [...selection].reduce((sum, id) => {
    const unit = state.units[id]
    // Only units in the army under attack count towards the tally.
    const inArmy = unit !== undefined && army.some((u) => u.id === id)
    return sum + (inArmy ? unitType(unit.typeId).health : 0)
  }, 0)

  return { absorbed, required, ready: absorbed === required, suggestion }
}

/** Which terrain the player should be looking at right now. */
export function focusedSlot(state: GameState): TerrainSlot {
  const pending = state.pending
  if (pending !== null && 'slot' in pending) return pending.slot
  const army = state.turn.marchingArmy
  if (army !== null && army !== 'reserve') return army
  return 'frontier'
}

/**
 * What the current decision lets the player pick, and where.
 *
 * `slot: null` means "my units, wherever they stand" — a retreat draws from every
 * terrain at once. A damage assignment names one terrain and must leave the other
 * two alone, which only started to matter once every army was on screen together:
 * while just one terrain was visible, "selectable" and "selectable *here*" were the
 * same question.
 */
export interface SelectMode {
  readonly side: 'mine' | 'reserve'
  readonly slot: TerrainSlot | null
}

export function selectModeFor(pending: Pending | null, human: 'p1' | 'p2'): SelectMode | null {
  if (pending === null || pending.player !== human) return null
  switch (pending.kind) {
    case 'assign_damage':
      return { side: 'mine', slot: pending.slot }
    case 'retreat':
      return { side: 'mine', slot: null }
    case 'reinforce':
      return { side: 'reserve', slot: null }
    default:
      return null
  }
}

/** Whether my army at `slot` is selectable under the current decision. */
export function selectableAt(mode: SelectMode | null, slot: TerrainSlot): boolean {
  return mode?.side === 'mine' && (mode.slot === null || mode.slot === slot)
}


/**
 * Display order for an army: grouped by class, biggest first inside each group.
 *
 * The class order is the one a player thinks in -- heavy melee, light melee,
 * missile, cavalry, magic -- not alphabetical. Within a class the heaviest die
 * leads, so the units that decide a damage assignment are where the eye lands
 * first, and identical dice end up side by side instead of scattered by whatever
 * order the preset happened to list them in.
 *
 * Presentation only. Selection is by unit id and damage suggestions come from the
 * engine, so nothing downstream depends on this order.
 */
const CLASS_ORDER: readonly UnitClass[] = [
  'heavy_melee',
  'light_melee',
  'missile',
  'cavalry',
  'magic',
]

export function orderedForDisplay(units: readonly UnitInstance[]): readonly UnitInstance[] {
  return [...units].sort((a, b) => {
    const left = unitType(a.typeId)
    const right = unitType(b.typeId)
    const byClass = CLASS_ORDER.indexOf(left.unitClass) - CLASS_ORDER.indexOf(right.unitClass)
    if (byClass !== 0) return byClass
    if (left.health !== right.health) return right.health - left.health
    // A stable, readable tiebreak, so two dice of the same class and size always
    // appear in the same order rather than shuffling between renders.
    return left.name.localeCompare(right.name)
  })
}
