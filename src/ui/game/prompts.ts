/**
 * Turns `state.pending` into a sentence and a set of buttons.
 *
 * Pure, and the single place that decides what the game is asking for. The action
 * bar renders whatever this returns, so no component ever tracks its own wizard
 * state or decides what is legal -- the engine already did both.
 */
import { expectedArmy, expectedAttack } from '../../ai/estimate'
import { dragonName, terrainDie, terrainDieName, terrainFaceAction, terrainType, unitType } from '../../data/load'
import { spell } from '../../data/spells'
import type { Element, TerrainFaceNumber, UnitClass, UnitType } from '../../data/types'
import { damageOptions } from '../../engine/damage'
import {
  castingsFor,
  magicRolled,
  spellTargetLabel as engineSpellTargetLabel,
  targetsFor,
  type SpellAim,
  type SpellTargetOffer,
} from '../../engine/magic'
import { growthPartners, promotionGain } from '../../engine/dua'
import { ALL_RESULT_TYPES, type Modifier } from '../../engine/pipeline'
import { isAsleep, type Effect } from '../../engine/effects'
import { legalDirections, rollsOnTheTable, type TableRoll } from '../../engine/turn'
import {
  TERRAIN_SLOTS,
  armyAt,
  army as armyRef,
  armyRefOf,
  livingUnits,
  reserveArmy,
  type ActionKind,
  type ArmyRef,
  type Direction,

  type GameAction,
  type GameState,
  type LogEntry,
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
  /**
   * Element dots drawn after the label (v1 Phase 10e): a proposed Frontier's two
   * colours, which are what decides whose terrain it is. Spelled out in `plainLabel`.
   */
  readonly elements?: readonly Element[]
  readonly action: GameAction
  /** Marks the "do nothing" option so it can be styled as secondary. */
  readonly passive?: boolean
  /**
   * A second, quieter line on the button (v2 Phase 3b): what the answer is expected to
   * come to -- "expect ≈6, they save ≈3". Read off `estimate.ts`, the one place faces
   * become numbers, so it is a display of the estimator and never a second calculation.
   */
  readonly detail?: string
  /**
   * The answer that is legal but almost never right (Phase 9f): drawn smaller as well as
   * secondary. Stepping a captured terrain down off its eighth face is the case -- it
   * gives up the capture, and it used to be the green button.
   */
  readonly emphasis?: 'low'
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
  const elements = choice.elements === undefined ? '' : ` — ${choice.elements.join(' and ')}`
  return choice.label
    .split('{}')
    .map((text, i) => {
      const hint = faces[i]
      return hint === undefined ? text : text + describeFace(hint)
    })
    .join('') + elements + (choice.detail === undefined ? '' : ` (${choice.detail})`)
}

/** An expectation, rounded and marked as one. */
const about = (n: number): string => `≈${Math.round(n)}`

/** "expect ≈6, they save ≈3": both rolls of an attack, before either is thrown. */
function attackForecast(
  state: GameState,
  player: PlayerId,
  from: ArmyRef,
  action: 'melee' | 'missile',
  target: ArmyRef,
  isCounter = false,
): string {
  const expected = expectedAttack(state, player, from, action, target, isCounter)
  return `expect ${about(expected.attack.total)}, they save ${about(expected.save.total)}`
}

/**
 * What choosing `action` is expected to roll. Melee names both rolls, because its
 * target is fixed: the army facing you. A missile's target is chosen next, so its
 * button gives the attack alone and the target buttons give both. Magic is its points,
 * which is what an announcement spends.
 */
function actionForecast(state: GameState, player: PlayerId, slot: ArmyRef, action: ActionKind): string {
  if (action === 'melee' && slot !== 'reserve') return attackForecast(state, player, slot, 'melee', slot)
  return `expect ${about(expectedArmy(state, player, slot, action).total)} ${action}`
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
    | 'accelerated_growth'
    | 'temple_bury'
    | 'dragon_treasure'
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

/**
 * "Coastland · city (your proposal)" -- a proposed Frontier, named before it has a slot
 * to be called by (v1 Phase 10e). The prompt and the log both say it, so it is written
 * once, here.
 */
export function proposalLabel(dieId: string, proposer: PlayerId, human: PlayerId): string {
  return `${terrainDieName(dieId)} (${proposer === human ? 'your' : "the enemy's"} proposal)`
}

/** A proposed Frontier's two elements, for the dots on its button. */
function proposalElements(dieId: string): readonly Element[] {
  return terrainType(terrainDie(dieId).type).elements
}

export function promptFor(pending: Pending, human: 'p1' | 'p2', state: GameState): Prompt {
  const label = (slot: ArmyRef) => slotLabel(slot, human)

  switch (pending.kind) {
    // The roll-off (v1 Phase 10e): one prize or the other. Naming what the opponent then
    // gets is the whole question -- "the first turn" alone reads as a free extra.
    case 'roll_off_choice':
      return {
        question:
          'You won the roll-off. Take the first turn and let the enemy pick the Frontier, ' +
          'or pick the Frontier and let the enemy go first?',
        choices: [
          { label: 'Take the first turn', action: { kind: 'roll_off_choice', take: 'first_turn' } },
          ...(['p1', 'p2'] as const).map((proposer) => ({
            label: `Frontier: ${proposalLabel(pending.proposals[proposer], proposer, human)}`,
            elements: proposalElements(pending.proposals[proposer]),
            action: { kind: 'roll_off_choice', take: 'frontier', proposer } as GameAction,
          })),
        ],
      }

    case 'choose_frontier':
      return {
        question: 'The enemy took the first turn. Which proposed terrain becomes the Frontier?',
        choices: (['p1', 'p2'] as const).map((proposer) => ({
          label: proposalLabel(pending.proposals[proposer], proposer, human),
          elements: proposalElements(pending.proposals[proposer]),
          action: { kind: 'choose_frontier', proposer } as GameAction,
        })),
      }

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

      // Holding the eighth face, the only way is down -- off the capture, and off the
      // power that comes with it. Legal, and nearly always a mistake, so keeping it is
      // the primary answer and going down is the small one (Phase 9f).
      if (terrain.face === 8 && terrain.capturedBy === pending.player) {
        return {
          question: `You hold the eighth face at ${label(pending.slot)}. Keep it?`,
          choices: [
            {
              label: 'Keep it at {}',
              faces: [{ dieId, face: terrain.face }],
              action: { kind: 'choose_maneuver', maneuver: false },
            },
            {
              label: 'Maneuver down to {}',
              faces: reachable,
              action: { kind: 'choose_maneuver', maneuver: true },
              passive: true,
              emphasis: 'low',
            },
          ],
        }
      }

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
            detail: actionForecast(state, pending.player, pending.slot, action),
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
          ...(state.turn.marchingArmy === null
            ? {}
            : { detail: attackForecast(state, pending.player, state.turn.marchingArmy, 'missile', slot) }),
          action: { kind: 'choose_missile_target', slot } as GameAction,
        })),
      }

    case 'choose_counter_attack':
      return {
        question: 'Counter-attack?',
        choices: [
          {
            label: 'Counter-attack',
            detail: attackForecast(state, pending.player, pending.slot, 'melee', pending.slot, true),
            action: { kind: 'choose_counter_attack', counter: true },
          },
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

    // "Of their choice" -- tapped in the DUA since Phase 9f; it used to be one button
    // per unit, named, which is a second way of picking a die.
    case 'temple_bury':
      return {
        question: 'The Temple forces a burial — tap one of your dead dice in the Fallen area',
        choices: [],
        custom: 'temple_bury',
      }

    // The same grid as a damage assignment, for the same reason: five health-worth
    // of your own army, chosen by you, maximally.
    case 'dragon_breath':
      return {
        question: `${dragonBreathName(state, pending.dragonId)}: lose ${pending.health} health-worth`,
        choices: [],
        custom: 'dragon_breath',
      }

    // One unit, one step, and the army *may* decline. Picked like every other pair since
    // Phase 9f: your die on the board, then what it becomes in the DUA.
    case 'dragon_treasure':
      return {
        question: 'Treasure! Promote one unit — tap one of yours, then what it becomes in your DUA',
        choices: [],
        custom: 'dragon_treasure',
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

    case 'accelerated_growth':
      return {
        question:
          pending.dying.length === 1
            ? `Accelerated Growth: ${unitName(state, pending.dying[0] as UnitId)} is dying` +
              ' — exchange it for a one-health die from your DUA?'
            : `Accelerated Growth: ${pending.dying.length} of your dice are dying` +
              ' — exchange any for one-health dice from your DUA?',
        choices: [],
        custom: 'accelerated_growth',
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

/**
 * Accelerated Growth, as one selection over the DUA: the dying dice to save and the
 * small dice to bring back, both tapped where they lie.
 *
 * **Which dying die pairs with which small one does not matter** -- every partner is a
 * one-health die going to the place the dead one stood, and the dead one goes to the
 * DUA either way -- so the player picks two sets of equal size and the pairs are
 * formed here, in the order the offer lists them. The first cut paired them one by one
 * with the partners as sheet buttons, which with a DUA full of one-health dice was a
 * long row of look-alike buttons and a second way of picking a die.
 */
export interface GrowthDraft {
  /** Dying dice in the selection. */
  readonly saving: readonly UnitId[]
  /** One-health dice in the selection. */
  readonly bringing: readonly UnitId[]
  /** The answer, once the two counts agree. Null while they do not. */
  readonly pairs: readonly PromotionPair[] | null
}

export function growthDraft(
  pending: Extract<Pending, { kind: 'accelerated_growth' }>,
  selection: ReadonlySet<UnitId>,
): GrowthDraft {
  const saving = pending.dying.filter((id) => selection.has(id))
  const bringing = pending.partners.filter((id) => selection.has(id))
  return {
    saving,
    bringing,
    pairs:
      saving.length === bringing.length
        ? saving.map((unitId, i) => ({ unitId, partnerId: bringing[i] as UnitId }))
        : null,
  }
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
  readonly side: 'mine' | 'theirs' | 'reserve' | 'dua' | 'any'
  /** A Reserve Army is a legal target since Phase 5d's Tower, so this is an
   *  `ArmyRef` rather than a `TerrainSlot`; `null` still means "wherever". */
  readonly slot: ArmyRef | null
  /**
   * With `side: 'any'` (Phase 9f): exactly these dice respond, wherever they are drawn
   * -- a terrain, a reserve, the DUA. A spell's target can be anybody's die anywhere, and
   * a promotion pairs a die on the board with one in the DUA, which no side-and-slot
   * rule can say.
   */
  readonly only?: ReadonlySet<UnitId>
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
    // The dying dice are already in the DUA, so that is where they are tapped.
    case 'accelerated_growth':
      return { side: 'dua', slot: null }
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
  // 'any' lights whole grids and lets `only` pick the dice inside them.
  if (mode?.side === 'any') return true
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

/** An effect as the board draws it: identical ones counted, not listed (v2 Phase 3b). */
export interface EffectChip extends ArmyEffect {
  readonly count: number
}

/**
 * Effects as chips, one per distinct effect, with a count.
 *
 * Eight spells on one army used to be eight lines, which on a phone held sideways is
 * most of the screen (Phase 3a). Identical means the same source, the same arithmetic
 * and the same end, so two Stone Skins cast on different turns stay two chips: they
 * run out at different times, and that is a difference you plan against. In the order
 * each first appears.
 */
export function effectChips(effects: readonly ArmyEffect[]): readonly EffectChip[] {
  const chips = new Map<string, EffectChip>()
  for (const effect of effects) {
    const key = JSON.stringify([effect.source, effect.what, effect.until])
    const seen = chips.get(key)
    chips.set(key, seen === undefined ? { ...effect, count: 1 } : { ...seen, count: seen.count + 1 })
  }
  return [...chips.values()]
}

/**
 * **One way to pick a die** (v1 Phase 9f): every die a decision is asking about is
 * tapped where it is drawn -- on the board, in a reserve, in the DUA. The sheet keeps
 * only answers that are not dice: terrains, armies, spells, counts, and Confirm.
 *
 * Before this, half the decisions picked from the board and half from a row of sheet
 * buttons named after dice ("Pine, Pine, Pine"), and a DUA full of one-health dice was
 * a long row of look-alikes. `pickModeFor` is which dice respond, and `tapMeaning` is
 * what a tap on one does; `App` does what it says and nothing else.
 */
export function pickModeFor(
  state: GameState,
  pending: Pending | null,
  human: PlayerId,
  selection: ReadonlySet<UnitId>,
  pairs: readonly PromotionPair[],
  aiming: SpellAim | null,
): SelectMode | null {
  if (pending === null || pending.player !== human) return null
  const any = (ids: Iterable<UnitId>): SelectMode => ({ side: 'any', slot: null, only: new Set(ids) })

  switch (pending.kind) {
    case 'announce_spells': {
      const offers = spellUnitOffers(pending, aiming)
      return offers === null ? null : any(offers.keys())
    }
    // Wild Growth: your die on the board, then what it grows into in the DUA.
    case 'sai_promote': {
      const draft = promoteDraft(state, pending, pairs, selection)
      return any([...draft.growable.map((u) => u.id), ...draft.partners.map((p) => p.unit.id)])
    }
    case 'eighth_face_city': {
      const chosen = chosenOf(selection, pending.promotions.map((p) => p.unitId))
      return any([
        ...pending.promotions.map((p) => p.unitId),
        ...pending.recruits,
        ...partnersOf(pending.promotions, chosen),
      ])
    }
    case 'dragon_treasure': {
      const chosen = chosenOf(selection, pending.promotions.map((p) => p.unitId))
      return any([...pending.promotions.map((p) => p.unitId), ...partnersOf(pending.promotions, chosen)])
    }
    case 'temple_bury':
      return any(pending.options)
    default:
      return selectModeFor(pending, human)
  }
}

/** What a tap on a die means under the current decision. */
export type Tap =
  /** Into or out of the selection -- a damage assignment, a retreat. */
  | { readonly kind: 'toggle' }
  /** The only one picked from `group`: tapping another replaces it. */
  | { readonly kind: 'radio'; readonly group: ReadonlySet<UnitId> }
  /** Wild Growth: this dead die is what the chosen one grows into. */
  | { readonly kind: 'pair'; readonly pair: PromotionPair }
  /** A spell aimed at this die, with its castings. */
  | { readonly kind: 'cast'; readonly target: SpellTarget; readonly count: number }

export function tapMeaning(
  state: GameState,
  pending: Pending | null,
  selection: ReadonlySet<UnitId>,
  pairs: readonly PromotionPair[],
  aiming: SpellAim | null,
  unitId: UnitId,
): Tap {
  if (pending === null) return { kind: 'toggle' }
  switch (pending.kind) {
    case 'announce_spells': {
      const offer = spellUnitOffers(pending, aiming)?.get(unitId)
      if (offer === undefined || aiming === null) return { kind: 'toggle' }
      return {
        kind: 'cast',
        target: offer.target,
        count: castingsFor(aiming, spell(aiming.spell), offer.minCount),
      }
    }
    case 'sai_promote': {
      const draft = promoteDraft(state, pending, pairs, selection)
      const chosen = [...selection].find((id) => draft.growable.some((u) => u.id === id))
      if (chosen !== undefined && draft.partners.some((p) => p.unit.id === unitId)) {
        return { kind: 'pair', pair: { unitId: chosen, partnerId: unitId } }
      }
      return { kind: 'radio', group: new Set(draft.growable.map((u) => u.id)) }
    }
    case 'eighth_face_city':
    case 'dragon_treasure': {
      const board = new Set(pending.promotions.map((p) => p.unitId))
      if (board.has(unitId)) return { kind: 'radio', group: board }
      const dua = pending.kind === 'eighth_face_city' ? [...pending.recruits] : []
      return { kind: 'radio', group: new Set([...dua, ...pending.promotions.map((p) => p.partnerId)]) }
    }
    case 'temple_bury':
      return { kind: 'radio', group: new Set(pending.options) }
    default:
      return { kind: 'toggle' }
  }
}

/** The one die in `group` that is selected, if any. */
function chosenOf(selection: ReadonlySet<UnitId>, group: readonly UnitId[]): UnitId | undefined {
  return group.find((id) => selection.has(id))
}

function partnersOf(promotions: readonly PromotionPair[], chosen: UnitId | undefined): UnitId[] {
  return chosen === undefined ? [] : promotions.filter((p) => p.unitId === chosen).map((p) => p.partnerId)
}

/**
 * The dice a spell being aimed may be tapped on, each with its offer -- or null when
 * the spell is not aimed at units, or no element has been settled yet.
 */
export function spellUnitOffers(
  pending: Extract<Pending, { kind: 'announce_spells' }>,
  aiming: SpellAim | null,
): ReadonlyMap<UnitId, SpellTargetOffer> | null {
  if (aiming === null) return null
  const castable = pending.castable.find((c) => c.spell.id === aiming.spell)
  if (castable === undefined) return null
  const element = aiming.element ?? (castable.elements.length === 1 ? castable.elements[0] : undefined)
  if (element === undefined) return null
  const offers = new Map<UnitId, SpellTargetOffer>()
  for (const offer of targetsFor(castable, element)) {
    if (offer.target.kind !== 'units') continue
    const [only] = offer.target.unitIds
    if (only !== undefined && offer.target.unitIds.length === 1) offers.set(only, offer)
  }
  return offers.size === 0 ? null : offers
}

/**
 * City: a recruit (one dead die, alone) or a promotion (one of yours, then its partner),
 * read off the selection. Null while neither is complete.
 */
export function cityAnswer(
  pending: Extract<Pending, { kind: 'eighth_face_city' }>,
  selection: ReadonlySet<UnitId>,
): Extract<GameAction, { kind: 'eighth_face_city' }>['choice'] {
  const chosen = chosenOf(selection, pending.promotions.map((p) => p.unitId))
  if (chosen !== undefined) {
    const pair = pending.promotions.find((p) => p.unitId === chosen && selection.has(p.partnerId))
    return pair === undefined ? null : { kind: 'promote', pair }
  }
  const recruit = pending.recruits.find((id) => selection.has(id))
  return recruit === undefined ? null : { kind: 'recruit', unitId: recruit }
}

/** Dragon treasure: the promotion the selection names, or null. */
export function treasureAnswer(
  pending: Extract<Pending, { kind: 'dragon_treasure' }>,
  selection: ReadonlySet<UnitId>,
): PromotionPair | null {
  return pending.promotions.find((p) => selection.has(p.unitId) && selection.has(p.partnerId)) ?? null
}

/**
 * The roll behind a decision (v1 Phase 9d): what a player -- or the enemy, while it
 * thinks -- is looking at when they answer.
 *
 * Two sources, because a decision is either *inside* a roll or *after* one:
 *
 *  - **live**: the machine has dice parked mid-exchange (`rollsOnTheTable`). At the
 *    delayed pause that is the attack roll *and* the save roll: a Confuse face is on the
 *    first and replaces dice in the second, and showing only one is how Confuse came to
 *    be reported as firing on the wrong roll.
 *  - **logged**: the roll has already been counted and written down, and the question
 *    is its consequence -- how to take the damage, whether to counter-attack, which way
 *    to turn a terrain just won. That roll is the last one in the log, drawn by the same
 *    renderer the log uses, so the sheet and the log cannot show one roll two ways.
 */
export type RollsBehind =
  | { readonly kind: 'live'; readonly rolls: readonly TableRoll[] }
  | { readonly kind: 'logged'; readonly entries: readonly LogEntry[] }

/** Decisions that answer a roll already counted. Anything else with nothing parked has
 *  no roll behind it -- a march, an action, a spell announcement. */
const FOLLOWS_A_ROLL: ReadonlySet<Pending['kind']> = new Set([
  'assign_damage',
  'choose_counter_attack',
  'choose_direction',
  'dragon_breath',
  'dragon_damage_split',
  'accelerated_growth',
])

/** Log entries that *are* a roll, as opposed to its consequences. */
const ROLL_ENTRIES: ReadonlySet<LogEntry['kind']> = new Set([
  'combat_resolved',
  'maneuver_contested',
  'spell_saves',
  'thorns',
  'dragon_roll',
  'dragon_damage',
])

export function rollsBehind(state: GameState, pending: Pending | null): RollsBehind | null {
  const live = rollsOnTheTable(state)
  if (live.length > 0) return { kind: 'live', rolls: live }
  if (pending === null || !FOLLOWS_A_ROLL.has(pending.kind)) return null

  const log = state.log
  let last = log.length - 1
  while (last >= 0 && !ROLL_ENTRIES.has((log[last] as LogEntry).kind)) last -= 1
  if (last < 0) return null

  // A dragon's damage is three entries, not one -- the dragons' throw, the army's
  // answer, and the subtraction -- and the damage line alone would be the bare number
  // this phase exists to explain. So a dragon roll brings the throw that caused it.
  const head = log[last] as LogEntry
  if (head.kind === 'dragon_damage' || head.kind === 'dragon_roll') {
    const from = Math.max(0, last - 6)
    const group = log
      .slice(from, last + 1)
      .filter((e) => e.kind === 'dragon_attack' || e.kind === 'dragon_roll' || e.kind === 'dragon_damage')
    const start = group.map((e) => e.kind).lastIndexOf('dragon_attack')
    return { kind: 'logged', entries: start < 0 ? group : group.slice(start) }
  }
  // Replanting rolls on the way to the DUA, after the kill that caused it -- and it is
  // what an Accelerated Growth question is asked beside, so it rides along.
  const after = log.slice(last + 1).filter((e) => e.kind === 'replanting' || e.kind === 'confused')
  return { kind: 'logged', entries: [head, ...after] }
}

/** "Your melee attack", "the enemy's saves" -- a live strip's heading. */
export function tableRollHeading(roll: TableRoll, human: PlayerId): string {
  const whose = roll.player === human ? 'Your' : "The enemy's"
  switch (roll.kind) {
    case 'attack':
      return `${whose} ${roll.action ?? ''} attack`.replace('  ', ' ')
    case 'save':
      return `${whose} saves`
    case 'maneuver':
      return `${whose} maneuver roll`
    case 'dragon':
      return `${whose} roll against the dragons`
  }
}

/**
 * Which dice in the rolls behind a decision are themselves answers -- the strip is
 * where a player is looking, so it takes the tap as well as the board does.
 *
 * Flashfire and Rapid Growth have always picked from their strip. Phase 9d adds the
 * targeting SAIs: at the delayed pause a Confuse or a Choke is choosing among the
 * defender's *save dice*, and the save strip is the only place their faces are drawn.
 * Every strip is given the same set, and a die outside it simply is not pickable, so
 * the attack strip above never lights up.
 */
export function pickableIn(pending: Pending | null, state: GameState): ReadonlySet<UnitId> | null {
  if (pending === null) return null
  switch (pending.kind) {
    case 'flashfire':
    case 'rapid_growth':
      return new Set(pending.options)
    case 'sai_target':
      return new Set(
        pending.eligible ?? armyRef(state, pending.target, pending.slot).map((unit) => unit.id),
      )
    default:
      return null
  }
}

/**
 * Effects that sit on a *player* rather than an army -- Accelerated Growth, whose
 * "target your DUA" names neither an army nor a terrain. Drawn on the DUA, in the Fallen
 * section, because that is where its partners come from; before Phase 9a's follow-up it
 * was drawn nowhere at all, so a cast spell left no sign on the board that it was live.
 */
export function effectsOnPlayer(
  state: GameState,
  player: PlayerId,
  human: PlayerId,
): readonly ArmyEffect[] {
  return state.effects.flatMap((effect): ArmyEffect[] => {
    if (effect.target.kind !== 'player' || effect.target.player !== player) return []
    return [
      {
        source: effect.source,
        what: playerEffectText(effect.trigger, effect.modifiers),
        until: effect.expiresAtStartOfTurnOf === human ? 'your next turn' : "the enemy's next turn",
      },
    ]
  })
}

/** A player effect's rule in words. Exhaustive on the trigger, for `describeModifiers`'
 *  reason: a new trigger with no sentence is a build error, not an empty line. */
function playerEffectText(
  trigger: Effect['trigger'],
  modifiers: readonly Modifier[],
): string {
  switch (trigger) {
    case 'accelerated_growth':
      return 'a dying unit of 2+ health swaps with a 1-health unit from this DUA'
    case undefined:
      return describeModifiers(modifiers)
  }
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
