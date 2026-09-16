/**
 * Turns `state.pending` into a sentence and a set of buttons.
 *
 * Pure, and the single place that decides what the game is asking for. The action
 * bar renders whatever this returns, so no component ever tracks its own wizard
 * state or decides what is legal -- the engine already did both.
 */
import { terrainDie, terrainFaceAction, unitType } from '../../data/load'
import type { TerrainFaceNumber, UnitClass } from '../../data/types'
import { damageOptions } from '../../engine/damage'
import { isAsleep } from '../../engine/effects'
import { legalDirections } from '../../engine/turn'
import {
  TERRAIN_SLOTS,
  armyAt,
  reserveArmy,
  type Direction,

  type GameAction,
  type GameState,
  type Pending,
  type PlayerId,
  type TerrainFace,
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

/**
 * A terrain face a button wants to draw.
 *
 * The die and the number, not the action: the real face art carries both the number
 * and the action icon, which is the whole reason a button shows the face rather than
 * a bare glyph. Resolving the art is the component's job.
 */
export interface FaceHint {
  readonly dieId: string
  readonly face: TerrainFace
}

export interface Choice {
  /**
   * The button's text, with `{}` wherever one of `faces` belongs: `'No (stays at
   * {})'`. A template rather than a pre-split list so the source reads as the
   * sentence the player sees, and so `prompts.ts` stays free of JSX.
   */
  readonly label: string
  /** Fills the `{}` slots in `label`, in order. */
  readonly faces?: readonly FaceHint[]
  readonly action: GameAction
  /** Marks the "do nothing" option so it can be styled as secondary. */
  readonly passive?: boolean
}

/**
 * The same sentence a `Choice` renders, with its faces spelled out as words.
 *
 * The buttons draw pictures of die faces, which reach assistive tech as nothing at
 * all -- "Maneuver (go to  or )". This is what goes in their `aria-label`, and it is
 * here rather than in the component so it can be tested without a DOM.
 */
export function plainLabel(choice: Choice): string {
  const faces = choice.faces ?? []
  return choice.label
    .split('{}')
    .map((text, i) => {
      const hint = faces[i]
      return hint === undefined ? text : text + describeFace(hint)
    })
    .join('')
}

export interface Prompt {
  readonly question: string
  readonly choices: readonly Choice[]
  /** Handled by a dedicated surface rather than plain buttons. */
  readonly custom?: 'assign_damage' | 'reinforce' | 'retreat'
}

const stepFace = (face: TerrainFace, direction: Direction): TerrainFace =>
  (direction === 'up' ? face + 1 : face - 1) as TerrainFace

/**
 * A face in words, for `aria-label` and for anywhere the art cannot be drawn.
 *
 * Face 8 has no action -- it has the die's eighth-face icon instead -- which is why
 * this is not simply the action name.
 */
export function describeFace({ dieId, face }: FaceHint): string {
  if (face === 8) return `the eighth face, ${terrainDie(dieId).eighthFace.replace(/_/g, ' ')}`
  return `face ${face}, ${terrainFaceAction(dieId, face as TerrainFaceNumber).toLowerCase()}`
}

export function promptFor(pending: Pending, human: 'p1' | 'p2', state: GameState): Prompt {
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

    case 'choose_maneuver': {
      const terrain = state.terrains[pending.slot]
      const dieId = terrain.dieId

      // Every face the maneuver could reach, including one that keeps the same
      // action: the face art carries the *number* as well as the icon, so face 2 and
      // face 4 are two different answers even when both say missile. The marcher
      // declares before choosing a direction, so both are honestly on offer.
      const reachable = legalDirections(terrain.face).map((direction) => ({
        dieId,
        face: stepFace(terrain.face, direction),
      }))

      return {
        question: `Maneuver the terrain at ${label(pending.slot)}?`,
        choices: [
          {
            label: `Maneuver (go to ${reachable.map(() => '{}').join(' or ')})`,
            faces: reachable,
            action: { kind: 'choose_maneuver', maneuver: true },
          },
          {
            label: 'No (stays at {})',
            faces: [{ dieId, face: terrain.face }],
            action: { kind: 'choose_maneuver', maneuver: false },
            passive: true,
          },
        ],
      }
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

    case 'choose_direction': {
      const terrain = state.terrains[pending.slot]

      return {
        question: `Turn ${label(pending.slot)} which way?`,
        // The direction word and the face it lands on, and nothing else. The face
        // art says what the terrain becomes better than any wording could, and the
        // word is still needed because only one of the two is progress towards
        // capturing the terrain.
        choices: pending.options.map((direction) => ({
          label: `${direction === 'up' ? 'Up' : 'Down'} — {}`,
          faces: [{ dieId: terrain.dieId, face: stepFace(terrain.face, direction) }],
          action: { kind: 'choose_direction', direction } as GameAction,
        })),
      }
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

/**
 * A reinforce draft: which reserve dice are going where.
 *
 * "You may move any or all of them to **any terrains**. You may split the reserve
 * units up, sending some to one terrain and some to another." The action has always
 * carried a slot per unit, but the sheet sent every chosen die to a single
 * destination and dispatched on the spot, so a reserve could only ever be committed
 * to one terrain per turn -- half the Reinforce Step, and the half that matters when
 * two fronts both need a die.
 *
 * So the destination buttons *stage* rather than dispatch, and this is the draft
 * they build up. It stays a draft answer to one question, like the damage selection:
 * one action still reaches the engine, and `App` throws it away when `pending`
 * changes.
 */
export interface ReinforceMove {
  readonly unitId: UnitId
  readonly slot: TerrainSlot
}

export interface ReinforcePlan {
  /** Reserve dice with no destination yet -- what the grid still offers. */
  readonly unassigned: readonly UnitInstance[]
  /** The answer, once the player is done. */
  readonly moves: readonly ReinforceMove[]
  /** Staged dice grouped by where they are going, in board order, empties dropped. */
  readonly byDestination: readonly {
    readonly slot: TerrainSlot
    readonly units: readonly UnitInstance[]
  }[]
}

export function reinforcePlan(
  state: GameState,
  player: PlayerId,
  staged: readonly ReinforceMove[],
): ReinforcePlan {
  const reserve = reserveArmy(state, player)

  // Filtered against the live reserve rather than trusted: a draft outlives nothing,
  // but it costs one line to make that true instead of assumed.
  const moves = staged.filter((move) => reserve.some((unit) => unit.id === move.unitId))
  const assigned = new Set(moves.map((move) => move.unitId))

  const unitOf = (id: UnitId) => reserve.find((unit) => unit.id === id)

  return {
    unassigned: reserve.filter((unit) => !assigned.has(unit.id)),
    moves,
    byDestination: TERRAIN_SLOTS.map((slot) => ({
      slot,
      units: moves
        .filter((move) => move.slot === slot)
        .map((move) => unitOf(move.unitId))
        .filter((unit): unit is UnitInstance => unit !== undefined),
    })).filter((group) => group.units.length > 0),
  }
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
 * Units that cannot be rolled or moved -- Sleep, today.
 *
 * A set rather than a predicate per tile, because the grid asks about every die it
 * draws. The engine refuses a sleeping unit as a retreat either way; this is what
 * stops the button being offered in the first place, and what gives the die a visible
 * reason for being unpickable.
 */
export function sleepingIds(state: GameState): ReadonlySet<UnitId> {
  const ids = new Set<UnitId>()
  for (const unit of Object.values(state.units)) {
    if (isAsleep(state, unit.id)) ids.add(unit.id)
  }
  return ids
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
