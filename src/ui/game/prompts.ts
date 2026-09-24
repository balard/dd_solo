/**
 * Turns `state.pending` into a sentence and a set of buttons.
 *
 * Pure, and the single place that decides what the game is asking for. The action
 * bar renders whatever this returns, so no component ever tracks its own wizard
 * state or decides what is legal -- the engine already did both.
 */
import { dragonName, terrainDie, terrainFaceAction, unitType } from '../../data/load'
import { spell } from '../../data/spells'
import type { TerrainFaceNumber, UnitClass, UnitType } from '../../data/types'
import { damageOptions } from '../../engine/damage'
import {
  magicRolled,
  spellTargetLabel as engineSpellTargetLabel,
} from '../../engine/magic'
import { growthPartners, promotionGain } from '../../engine/dua'
import { ALL_RESULT_TYPES, type Modifier } from '../../engine/pipeline'
import { isAsleep, type Effect } from '../../engine/effects'
import { legalDirections } from '../../engine/turn'
import {
  TERRAIN_SLOTS,
  armyAt,
  army as armyRef,
  armyRefOf,
  livingUnits,
  reserveArmy,
  type ArmyRef,
  type Direction,

  type GameAction,
  type GameState,
  type Pending,
  type PlayerId,
  type PromotionPair,
  type SpellTarget,
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

/** Slot labels from the perspective of whoever is reading. A Reserve Army is
 *  nobody's terrain, so it reads the same for both sides (Phase 5d, Tower). */
export function slotLabel(slot: ArmyRef, human: 'p1' | 'p2'): string {
  if (slot === 'reserve') return 'Reserves'
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
  readonly custom?:
    | 'assign_damage'
    | 'sai_target'
    | 'sai_promote'
    | 'sai_move'
    | 'reinforce'
    | 'retreat'
    | 'eighth_face_city'
    | 'dragon_breath'
    | 'dragon_allocate'
    | 'dragon_damage_split'
    | 'announce_spells'
    | 'flashfire'
    | 'rapid_growth'
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
  const label = (slot: ArmyRef) => slotLabel(slot, human)

  switch (pending.kind) {
    case 'choose_march_army':
      return {
        question: 'Which army marches?',
        choices: [
          ...pending.options.map((army) => ({
            label: label(army),
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

    // The one prompt that asks you to pick somebody else's dice, so it says whose and
    // where rather than leaving the sentence to imply it.
    case 'sai_target':
      return {
        question:
          `${pending.sai}: target ` +
          (pending.limit.kind === 'one'
            ? 'one die'
            : `${pending.limit.budget} health-worth`) +
          ` at ${label(pending.slot)}` +
          (pending.remaining > 1 ? ` (${pending.remaining} to place)` : ''),
        choices: [],
        custom: 'sai_target',
      }

    /**
     * Wild Growth and the free moves: the first prompts that can be answered with
     * nothing, and the first that reach into your *own* army.
     *
     * Both get their own sheet rather than a list of buttons, because both are "pick
     * some dice and then say what to do with them" -- which is the reinforce shape,
     * not the missile-target shape.
     */
    case 'sai_promote':
      return {
        question:
          `${pending.sai}: ${pending.budget} health of promotion` +
          (pending.remaining > 1 ? ` (${pending.remaining} to place)` : ''),
        choices: [],
        custom: 'sai_promote',
      }

    case 'sai_move':
      return {
        question:
          `${pending.sai}: walk off with up to ${pending.health} health-worth` +
          (pending.remaining > 1 ? ` (${pending.remaining} to place)` : ''),
        choices: [],
        custom: 'sai_move',
      }

    // A terrain, not dice -- so it is ordinary buttons, the way a missile target is.
    case 'sai_target_army':
      return {
        question:
          `${pending.sai}: which enemy army?` +
          (pending.remaining > 1 ? ` (${pending.remaining} to place)` : ''),
        choices: pending.options.map((slot) => ({
          label: label(slot),
          action: { kind: 'sai_target_army', slot },
        })),
      }

    case 'reinforce':
      return { question: 'Send units from reserve?', choices: [], custom: 'reinforce' }

    // Air Flight (Phase 8) gives the step a second answer, and the question has to say
    // so: "pull back to reserve?" over a sheet offering flights reads as a sheet whose
    // buttons do something other than what it asked.
    case 'retreat':
      return {
        question:
          (pending.flights ?? []).length > 0
            ? 'Pull units back to reserve, or use Air Flight to fly them to another air terrain?'
            : 'Pull units back to reserve?',
        choices: [],
        custom: 'retreat',
      }

    // Compound -- recruit, or promote, or neither -- so it gets its own sheet the
    // way Wild Growth's promotion draft does, rather than a button per option.
    case 'eighth_face_city':
      return {
        question: `City at ${label(pending.slot)}: recruit or promote one unit, or do nothing`,
        choices: [],
        custom: 'eighth_face_city',
      }

    case 'eighth_face_temple':
      return {
        question: `Force the Temple at ${label(pending.slot)} to make an opponent bury a unit?`,
        choices: [
          { label: 'Force a burial', action: { kind: 'eighth_face_temple', force: true } },
          {
            label: 'Let it go',
            action: { kind: 'eighth_face_temple', force: false },
            passive: true,
          },
        ],
      }

    // "Of their choice" -- one button per unit in the DUA, the way the DUA is
    // already shown as a plain list rather than a selectable grid.
    case 'temple_bury':
      return {
        question: 'The Temple forces a burial. Choose one of your DUA units.',
        choices: pending.options.map((unitId) => {
          const unit = state.units[unitId]
          return {
            label: unit === undefined ? unitId : unitType(unit.typeId).name,
            action: { kind: 'temple_bury', unitId },
          }
        }),
      }

    // The same grid as a damage assignment, for the same reason: five health-worth
    // of your own army, chosen by you, maximally.
    case 'dragon_breath':
      return {
        question: `${dragonBreathName(state, pending.dragonId)}: lose ${pending.health} health-worth`,
        choices: [],
        custom: 'dragon_breath',
      }

    // One unit, one step, and the army *may* decline -- so a button each rather
    // than the staged pairs Wild Growth needs for a budget.
    case 'dragon_treasure':
      return {
        question: 'Treasure! Promote one unit',
        choices: [
          ...pending.promotions.map((pair) => ({
            label: `${unitName(state, pair.unitId)} → ${unitName(state, pair.partnerId)}`,
            action: { kind: 'dragon_treasure', pair } as GameAction,
          })),
          { label: 'Decline', action: { kind: 'dragon_treasure', pair: null }, passive: true },
        ],
      }

    case 'dragon_allocate':
      return {
        question:
          `Your dragon roll counts melee, missile and save at once — split ` +
          [
            pending.ids > 0 ? `${pending.ids} ID` : '',
            pending.flexible > 0 ? `${pending.flexible} Create Fireminions` : '',
          ]
            .filter(Boolean)
            .join(' and ') +
          // Flaming Shields is a choice here and nowhere else: this roll counts saves
          // as well as melee, so every save moved is a save lost.
          ((pending.shields ?? 0) > 0
            ? `${pending.ids > 0 || pending.flexible > 0 ? ', and ' : ''}choose how many of ` +
              `${pending.shields} saves Flaming Shields counts as melee`
            : ''),
        choices: [],
        custom: 'dragon_allocate',
      }

    case 'dragon_damage_split':
      return {
        question: `Spend ${pending.melee} melee and ${pending.missile} missile on the dragons`,
        choices: [],
        custom: 'dragon_damage_split',
      }

    // A sheet rather than buttons: the answer is a set of your own dice, which is the
    // grid's job, and the same gesture damage assignment uses.
    case 'flashfire':
      return {
        question:
          `Flashfire: throw ${pending.budget === 1 ? 'a die' : `up to ${pending.budget} dice`} again?`,
        choices: [],
        custom: 'flashfire',
      }

    // Flashfire's sheet, for the same reason: the answer is a set of your own dice.
    case 'rapid_growth':
      return {
        question:
          `Rapid Growth: they maneuvered ${pending.marcher}, you ${pending.defender}` +
          ` — throw dice again to beat ${pending.marcher}?`,
        choices: [],
        custom: 'rapid_growth',
      }

    case 'dispel_magic':
      return {
        question:
          `Dispel Magic: roll ${unitName(state, pending.unitId)} to stop ` +
          `${pending.spells.map((id) => spell(id).name).join(', ')}?` +
          (pending.remaining > 1 ? ` (${pending.remaining} may try)` : ''),
        choices: [
          { label: 'Roll it', action: { kind: 'dispel_magic', roll: true } },
          { label: 'Let it through', action: { kind: 'dispel_magic', roll: false }, passive: true },
        ],
      }

    case 'dragon_order':
      return {
        question: 'Whose dragons attack first?',
        choices: pending.options.map((slot) => ({
          label: label(slot),
          action: { kind: 'dragon_order', slot },
        })),
      }

    // One decision covering every dragon that owes one, because the rules have both
    // owners declare and reveal together. With a single dragon owing a choice this is
    // still a list of one, which keeps the answer one shape.
    case 'dragon_target':
      return {
        question: `Which dragon does ${dragonNameOf(state, pending.choices[0]?.dragonId)} attack?`,
        choices: (pending.choices[0]?.options ?? []).map((dragonId) => ({
          label: dragonNameOf(state, dragonId),
          action: {
            kind: 'dragon_target',
            targets: Object.fromEntries(
              pending.choices.map((c) => [
                c.dragonId,
                c.dragonId === pending.choices[0]?.dragonId ? dragonId : (c.options[0] as string),
              ]),
            ),
          } as GameAction,
        })),
      }

    case 'spell_move':
      return {
        question: `Path: move ${pending.unitIds
          .map((id) => unitName(state, id))
          .join(', ')} where?`,
        choices: pending.options.map((slot) => ({
          label: label(slot),
          action: { kind: 'spell_move', slot },
        })),
      }

    case 'spell_summon':
      return {
        question:
          `Summon which dragon to ${label(pending.slot)}?` +
          (pending.remaining > 1 ? ` (${pending.remaining} to summon)` : ''),
        choices: pending.options.map((dragonId) => ({
          label: dragonNameOf(state, dragonId),
          action: { kind: 'spell_summon', dragonId },
        })),
      }

    // Nothing castable is the ordinary case until 7b, and it is not an error: the
    // results are simply lost. A sheet with no options would be a dead end, so the
    // no-spell case falls back to a plain button rather than `custom`.
    case 'announce_spells':
      return pending.castable.length === 0
        ? {
            question: magicRolled(pending.pool),
            choices: [
              {
                label: 'Cast nothing',
                action: { kind: 'announce_spells', casts: [] },
                passive: true,
              },
            ],
          }
        : {
            question: magicRolled(pending.pool),
            choices: [],
            custom: 'announce_spells',
          }
  }
}



const dragonNameOf = (state: GameState, dragonId: string | undefined): string => {
  const dragon = dragonId === undefined ? undefined : state.dragons[dragonId]
  return dragon === undefined ? 'a dragon' : dragonName(dragon.dieId)
}

const unitName = (state: GameState, unitId: UnitId): string => {
  const unit = state.units[unitId]
  return unit === undefined ? unitId : unitType(unit.typeId).name
}

const dragonBreathName = (state: GameState, dragonId: string): string => {
  const dragon = state.dragons[dragonId]
  return dragon === undefined ? 'Dragon breath' : dragonName(dragon.dieId)
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
  return budgetSelection(state, pending.player, pending.slot, pending.damage, selection)
}

/**
 * The same arithmetic for a targeting SAI, over the army being *targeted*.
 *
 * The rule is identical -- "you must apply the SAI's effect to the fullest extent
 * possible by selecting the maximum number of targets allowed" (full rules p. 32) is
 * the damage rule word for word -- so this shares the sheet, the tally and the confirm
 * gate rather than growing a second set of them. The only difference is whose army is
 * counted, which is why the two are one function underneath.
 *
 * The *friendly* targeting rule is not this one: "any number ... including none"
 * (p. 29) arrives with Wild Growth and the free moves, and it will need `ready` to
 * relax from `===` to `<=`.
 */
/**
 * A dragon breath: five health-worth of your own army, maximally.
 *
 * The damage sheet's arithmetic with the budget coming from a breath instead of a
 * total -- the same §6 rule, so the same function underneath rather than a second
 * tally that could disagree with it.
 */
export function breathSelection(
  state: GameState,
  pending: Extract<Pending, { kind: 'dragon_breath' }>,
  selection: ReadonlySet<UnitId>,
): DamageSelection {
  return budgetSelection(state, pending.player, pending.slot, pending.health, selection)
}

export function saiTargetSelection(
  state: GameState,
  pending: Extract<Pending, { kind: 'sai_target' }>,
  selection: ReadonlySet<UnitId>,
): DamageSelection {
  // Choke may take only the dice that rolled an ID icon, so they are the only ones
  // the tally counts and the only ones the maximum is measured against. Every other
  // SAI leaves `eligible` off and takes the army whole.
  const army = armyRef(state, pending.target, pending.slot).filter(
    (unit) => pending.eligible === undefined || pending.eligible.includes(unit.id),
  )

  // Sleep counts *dice*, not health: one die is one die whatever it weighs, so the
  // maximal-subset arithmetic has nothing to chew on. The sheet is the same; only
  // what the two numbers count changes, and `promptFor` says which in the question.
  if (pending.limit.kind === 'one') {
    const absorbed = [...selection].filter((id) => army.some((unit) => unit.id === id)).length
    const first = army[0]
    return {
      absorbed,
      required: army.length === 0 ? 0 : 1,
      ready: absorbed === 1,
      suggestion: first === undefined ? [] : [first.id],
    }
  }

  return budgetSelection(
    state,
    pending.target,
    pending.slot,
    pending.limit.budget,
    selection,
    pending.eligible,
  )
}

function budgetSelection(
  state: GameState,
  owner: 'p1' | 'p2',
  slot: ArmyRef,
  budget: number,
  selection: ReadonlySet<UnitId>,
  eligible?: readonly UnitId[],
): DamageSelection {
  const army = armyRef(state, owner, slot).filter(
    (unit) => eligible === undefined || eligible.includes(unit.id),
  )
  const { required, suggestion } = damageOptions(army, budget)

  const absorbed = [...selection].reduce((sum, id) => {
    const unit = state.units[id]
    // Only units in the army under attack count towards the tally.
    const inArmy = unit !== undefined && army.some((u) => u.id === id)
    return sum + (inArmy ? unitType(unit.typeId).health : 0)
  }, 0)

  return { absorbed, required, ready: absorbed === required, suggestion }
}

/**
 * A Wild Growth draft: which of your dice are growing into which of your dead.
 *
 * Pairs rather than a set of units, for the reason the *rule* is pairs: a dead Oak
 * Lord and a dead Redwood are both three health and are not the same die, and the
 * budget is spent on the health a promotion *gains* -- so which partner you pick is
 * both a tactical choice and a price.
 *
 * **Under budget is legal**, which no selection in this file before Phase 4e was:
 * p. 29's "any number ... including none" against p. 32's forced maximum. What is not
 * spent is save results, so there is no such thing as a wasted budget and no reason to
 * gate Confirm on anything.
 */
export interface PromoteDraft {
  readonly spent: number
  readonly left: number
  /** What stopping here would buy instead. */
  readonly saveResults: number
  /** The dice that could still grow, given what is left. */
  readonly growable: readonly UnitInstance[]
  /** What the one selected die could become, cheapest first. */
  readonly partners: readonly { readonly unit: UnitInstance; readonly cost: number }[]
}

export function promoteDraft(
  state: GameState,
  pending: Extract<Pending, { kind: 'sai_promote' }>,
  pairs: readonly PromotionPair[],
  selection: ReadonlySet<UnitId>,
): PromoteDraft {
  const spent = pairs.reduce((sum, pair) => sum + promotionGain(state, pair), 0)
  const left = pending.budget - spent

  const army = armyRef(state, pending.player, pending.slot).filter(
    (unit) => !pairs.some((pair) => pair.unitId === unit.id),
  )
  const taken = pairs.map((pair) => pair.partnerId)
  const options = (unit: UnitInstance) =>
    growthPartners(state, unit.id, left).filter((dead) => !taken.includes(dead.id))

  const [only] = [...selection].filter((id) => army.some((unit) => unit.id === id))
  const selected = only === undefined ? undefined : state.units[only]

  return {
    spent,
    left,
    saveResults: left,
    growable: army.filter((unit) => options(unit).length > 0),
    partners:
      selected === undefined
        ? []
        : options(selected)
            .map((dead) => ({
              unit: dead,
              cost: unitType(dead.typeId).health - unitType(selected.typeId).health,
            }))
            .sort((a, b) => a.cost - b.cost),
  }
}

/**
 * A free-move draft: who is going along, and whether that is still affordable.
 *
 * The mover is never in the selection -- it moves itself -- so everything counted here
 * is a passenger. `ready` is `<=` rather than `===`, which is the whole difference
 * between a friendly SAI and an opponent-targeting one.
 */
export interface MoveDraft {
  readonly carried: number
  readonly limit: number
  readonly ready: boolean
  /** Passengers that may not travel: a sleeping die cannot leave its terrain. */
  readonly stuck: ReadonlySet<UnitId>
}

export function moveDraft(
  state: GameState,
  pending: Extract<Pending, { kind: 'sai_move' }>,
  selection: ReadonlySet<UnitId>,
): MoveDraft {
  const army = armyRef(state, pending.player, pending.slot)
  const stuck = new Set<UnitId>()
  let carried = 0

  for (const id of selection) {
    if (id === pending.unitId) continue
    const unit = army.find((u) => u.id === id)
    if (unit === undefined) continue
    if (isAsleep(state, id)) stuck.add(id)
    carried += unitType(unit.typeId).health
  }

  return { carried, limit: pending.health, ready: carried <= pending.health && stuck.size === 0, stuck }
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

/**
 * The Retreat Step as a draft (Phase 8): which dice go back to reserve, and which fly.
 *
 * Air Flight gave the step a second destination, so it gained the Reinforce Step's
 * shape: a destination button *stages* the chosen dice rather than dispatching, and
 * one action still reaches the engine. The retreat half stays what it always was --
 * the dice selected when the player confirms -- so a force with nothing to fly sees
 * the same sheet it always did.
 */
export interface RetreatPlan {
  /** Selected dice that are not already flying: what "Pull back" would send. */
  readonly retreats: readonly UnitId[]
  /** Staged flights, each still legal against the pending's offers. */
  readonly flights: readonly ReinforceMove[]
  /** Terrains every selected die could fly to -- the fly buttons. Empty when any
   *  selected die cannot fly, or nothing is selected. */
  readonly flyTo: readonly TerrainSlot[]
}

export function retreatPlan(
  state: GameState,
  pending: Extract<Pending, { kind: 'retreat' }>,
  selection: ReadonlySet<UnitId>,
  staged: readonly ReinforceMove[],
): RetreatPlan {
  const offers = pending.flights ?? []
  // Filtered against the live offers rather than trusted, like `reinforcePlan`.
  const flights = staged.filter((move) =>
    offers.some((offer) => offer.unitId === move.unitId && offer.options.includes(move.slot)),
  )
  const flying = new Set(flights.map((move) => move.unitId))

  const movable = new Set(
    livingUnits(state, pending.player)
      .filter((unit) => unit.location.kind === 'terrain')
      .map((unit) => unit.id),
  )
  const retreats = [...selection].filter((id) => movable.has(id) && !flying.has(id))

  const flyTo =
    retreats.length === 0
      ? []
      : TERRAIN_SLOTS.filter((slot) =>
          retreats.every((id) =>
            offers.some((offer) => offer.unitId === id && offer.options.includes(slot)),
          ),
        )

  return { retreats, flights, flyTo }
}

/**
 * Which terrain the player should be looking at right now.
 *
 * A pending decision aimed at the Reserve Army (Phase 5d, Tower) has no terrain
 * card to highlight, so it falls through to the marching army's own terrain --
 * where the action came from -- the same fallback an unanswerable `marchingArmy`
 * already used.
 */
export function focusedSlot(state: GameState): TerrainSlot {
  const pending = state.pending
  if (pending !== null && 'slot' in pending && pending.slot !== 'reserve') return pending.slot
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
  /**
   * `'theirs'` is new with the targeting SAIs, and it is the first time the board has
   * had to offer the *enemy's* dice: every decision before it picked from your own
   * army, so `Board` hard-coded the opposing side unselectable.
   */
  readonly side: 'mine' | 'theirs' | 'reserve'
  /** A Reserve Army is a legal target since Phase 5d's Tower, so this is an
   *  `ArmyRef` rather than a `TerrainSlot`; `null` still means "wherever". */
  readonly slot: ArmyRef | null
}

export function selectModeFor(pending: Pending | null, human: 'p1' | 'p2'): SelectMode | null {
  if (pending === null || pending.player !== human) return null
  switch (pending.kind) {
    case 'assign_damage':
      return { side: 'mine', slot: pending.slot }
    // A breath picks from your own army, exactly as a damage assignment does.
    case 'dragon_breath':
      return { side: 'mine', slot: pending.slot }
    // Answered by the roller, about the army they are rolling against -- so the side
    // that is selectable is not the side the question was addressed to.
    case 'sai_target':
      return { side: 'theirs', slot: pending.slot }
    // Friendly, and so back to your own half of the board -- the first decisions since
    // `sai_target` to point there, and the first ever that may be answered with none.
    case 'sai_promote':
    case 'sai_move':
      return { side: 'mine', slot: pending.slot }
    // Your own dice, at the terrain that just rolled them.
    case 'flashfire':
      return { side: 'mine', slot: pending.slot }
    // The counter-maneuvering army's own dice, at the terrain being contested.
    case 'rapid_growth':
      return { side: 'mine', slot: pending.slot }
    case 'retreat':
      return { side: 'mine', slot: null }
    case 'reinforce':
      return { side: 'reserve', slot: null }
    default:
      return null
  }
}

/**
 * Whether an army at `slot` is selectable under the current decision.
 *
 * `side` says which army is being asked about -- the caller's own or the opponent's --
 * because the board draws both and only one of them is ever pickable at a time.
 */
/**
 * A key that changes whenever the draft answer to the current question would become
 * meaningless -- so `App` can throw the selection away on exactly those changes.
 *
 * **Kind and player are not enough**, which is the bug this exists to close: the Satyr
 * carries Sleep on two faces, so two of them rolling it produce two consecutive
 * `sai_target` pendings with the same kind and the same player. Without `remaining`
 * the key does not change, the first answer's selection survives into the second
 * question, and Confirm is enabled before anything has been picked for it. No engine
 * test can see that -- it is entirely a fact about the draft.
 */
export function pendingKey(pending: Pending | null): string {
  if (pending === null) return 'none'
  const step = 'remaining' in pending ? `:${pending.remaining}` : ''
  return `${pending.kind}:${pending.player}${step}`
}

export function selectableAt(
  mode: SelectMode | null,
  slot: ArmyRef,
  side: 'mine' | 'theirs' = 'mine',
): boolean {
  return mode?.side === side && (mode.slot === null || mode.slot === slot)
}

/**
 * What an effect sitting on an army actually does, in words.
 *
 * An effect with a duration is the one thing on the board that is true *between*
 * rolls, and until now the only sign of one was a die drawn dashed for Sleep and
 * nothing whatever for Galeforce: an army quietly saving at minus four, with the
 * arithmetic visible only in a log line that had already scrolled away.
 *
 * The modifier list is turned into text rather than named, because "Galeforce" tells
 * you which SAI and `-4 save, -4 maneuver` tells you what it will cost you, and only
 * one of those is a number you can plan against.
 */
export interface ArmyEffect {
  readonly source: string
  readonly what: string
  /** Whose turn it ends at the start of -- "yours" or "the enemy's", from `human`. */
  readonly until: string
}

export function effectsOnArmy(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
  human: PlayerId,
): readonly ArmyEffect[] {
  const out: ArmyEffect[] = []

  for (const effect of state.effects) {
    if (effect.target.kind !== 'army') continue
    if (effect.target.player !== player || effect.target.army !== slot) continue
    out.push({
      source: effect.source,
      what: describeModifiers(effect.modifiers),
      until: effect.expiresAtStartOfTurnOf === human ? 'your next turn' : "the enemy's next turn",
    })
  }

  // A unit effect is drawn on the die itself -- a sleeping die is dashed and says so
  // in its label -- but the army heading is where you look to see what an army is
  // carrying, so it is counted here too.
  const asleep = armyAt(state, player, slot).filter((unit) => isAsleep(state, unit.id))
  for (const unit of asleep) {
    const effect = state.effects.find(
      (e) => e.target.kind === 'unit' && e.target.unitId === unit.id && e.asleep === true,
    )
    out.push({
      source: effect?.source ?? 'Sleep',
      what: `${unitType(unit.typeId).name} cannot be rolled or leave`,
      until:
        effect?.expiresAtStartOfTurnOf === human ? 'your next turn' : "the enemy's next turn",
    })
  }

  return out
}

/**
 * `-4 save, -4 maneuver`, or "no arithmetic" for a status like Sleep.
 *
 * **The callback is annotated `: string`, and that is load-bearing** -- the same rule
 * `effectSummary` in `roll.ts` carries, and for the same reason. Without it a missing
 * `case` returns `undefined`, `join` renders it as nothing, and the army header prints
 * a source name followed by an empty half-sentence. `ignore_ids` had been missing here
 * since Phase 6 for exactly that reason: the Death breath is out of this plan's reach,
 * so nothing ever drew it. Annotated, a new `Modifier` kind is a build error here.
 */
function describeModifiers(modifiers: readonly Modifier[]): string {
  const parts = modifiers.map((modifier): string => {
    switch (modifier.kind) {
      case 'subtract':
        return `\u2212${modifier.amount} ${modifier.resultType}`
      case 'add':
        return `+${modifier.amount} ${modifier.resultType}`
      case 'divide':
        return `${modifier.resultType} \u00f7 ${modifier.by}`
      case 'multiply':
        return `${modifier.resultType} \u00d7 ${modifier.by}`
      case 'ignore_ids':
        return `no ${modifier.resultType} from IDs`
      // Never on an effect -- `armyRoll` gathers it from the species, not from
      // `state.effects` -- but a `Modifier` all the same, so it is named here too.
      case 'counts_as':
        return `${modifier.from} counts as ${modifier.resultType}`
    }
  })
  return collapseEveryType(parts, modifiers)
}

/** "-1 to every result" rather than five copies of "-1 melee". Ash Storm is the only
 *  spell in scope that speaks about a roll rather than a result type. */
function collapseEveryType(parts: readonly string[], modifiers: readonly Modifier[]): string {
  if (modifiers.length !== ALL_RESULT_TYPES.length) return parts.join(', ')
  if (new Set(modifiers.map((m) => m.resultType)).size !== ALL_RESULT_TYPES.length) {
    return parts.join(', ')
  }

  const head = (part: string) => part.slice(0, part.lastIndexOf(' '))
  const first = head(parts[0] ?? '')
  return parts.every((part) => head(part) === first) ? `${first} to every result` : parts.join(', ')
}

/**
 * A spell target in the browser's vocabulary.
 *
 * The join lives in `magic.ts` because the terminal needs it too; what differs is how
 * each client names a terrain, which is what `slotLabel` is for.
 */
export function spellTargetLabel(
  target: SpellTarget,
  human: 'p1' | 'p2',
  state: GameState,
): string {
  return engineSpellTargetLabel(
    target,
    human,
    (ref) => slotLabel(ref, human),
    (id) => unitName(state, id),
    (id) => armyRefOf(state, id),
  )
}

/**
 * Effects sitting on a terrain rather than on either army (Phase 7b).
 *
 * Drawn on the terrain card head and not inside an `ArmySide`, because that is what
 * they are: Ash Storm subtracts from *both* players' rolls there, and Wall of Fog
 * wards the place against missile fire from anywhere. Filing either under one army
 * would say the opposite of what the rule does.
 */
export function effectsOnTerrain(
  state: GameState,
  slot: TerrainSlot,
  human: PlayerId,
): readonly ArmyEffect[] {
  const out: ArmyEffect[] = []

  for (const effect of state.effects) {
    if (effect.target.kind !== 'terrain' || effect.target.slot !== slot) continue
    out.push({
      source: effect.source,
      what: describeTerrainEffect(effect),
      until: effect.expiresAtStartOfTurnOf === human ? 'your next turn' : "the enemy's next turn",
    })
  }

  return out
}

/**
 * What a terrain effect costs whoever it reaches.
 *
 * Wall of Thorns is why this is not just `describeModifiers`: it carries **no
 * modifiers at all**, so the generic path printed a source name and an empty
 * half-sentence -- the same shape `describeModifiers`' missing `ignore_ids` case
 * printed until 7b, arriving from the other direction. A ward whose damage is
 * invisible is a ward you cannot plan around, which is the whole reason effects are
 * drawn on the board.
 */
function describeTerrainEffect(effect: Effect): string {
  if (effect.target.kind !== 'terrain') return describeModifiers(effect.modifiers)

  switch (effect.target.scope) {
    case 'attackers':
      return `${describeModifiers(effect.modifiers)} for anyone attacking here`
    case 'maneuverers':
      return `${effect.thorns ?? 0} damage to an army that maneuvers here`
    case 'all_armies':
      return describeModifiers(effect.modifiers)
  }
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
 * Display order for an army: monsters first, then by class, biggest first inside
 * each group.
 *
 * The class order is the one a player thinks in -- heavy melee, light melee,
 * missile, cavalry, magic -- not alphabetical. Within a class the heaviest die
 * leads, so the units that decide a damage assignment are where the eye lands
 * first, and identical dice end up side by side instead of scattered by whatever
 * order the preset happened to list them in.
 *
 * **Monsters are their own group**, ahead of the rest, because a monster has no
 * class. The data files each one under a class line -- Strangle Vine under missile,
 * Gorgon under cavalry -- but that is how the box is organised, not what the die
 * does: Strangle Vine has no missile face beyond its ID. Sorting a monster into a
 * class it does not play was the same claim the tile badge used to make.
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
    // A monster sorts by being a monster, never by the class line it is filed under.
    const rank = (t: UnitType) =>
      t.size === 'monster' ? -1 : CLASS_ORDER.indexOf(t.unitClass)
    const byClass = rank(left) - rank(right)
    if (byClass !== 0) return byClass
    if (left.health !== right.health) return right.health - left.health
    // A stable, readable tiebreak, so two dice of the same class and size always
    // appear in the same order rather than shuffling between renders.
    return left.name.localeCompare(right.name)
  })
}
