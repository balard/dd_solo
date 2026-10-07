/**
 * One roll, shown before the game moves on (v2 Phase 3c): the dice, then Continue.
 *
 * It takes the decision's place in the floating dialog, so the player's eye is in one
 * spot for the whole exchange: the attacker's dice, any SAI that fired, the resisting
 * roll with what they came to, then the question those rolls lead to. Every part is
 * drawn with the log's own pieces (`CombatPart`, `ManeuverPart`, `LogLine`), so the card
 * and the log cannot show one roll two ways.
 *
 * **The frame is v2 Phase 9b's**: the exchange's step bar on top, then a heading that
 * says whose roll and where, with the total beside it on every card that has one -- a
 * live card included, whose total used to be a bare number in the strip. The strips'
 * own labels ("MANEUVER", "SAVES") are left off here, because the heading says it.
 */
import { unitType } from '../../data/load'
import type { DieRoll } from '../../engine/roll'
import type { ArmyRef, GameState, LogEntry, PlayerId } from '../../engine/types'

import { RollStrip, effectSummary, saiName } from './DiceGrid'
import type { Exchange } from './exchange'
import { CombatPart, LogLine, ManeuverPart } from './LogPanel'
import { marcherOf, ownerIn, type RollStep } from './presentation'
import { slotLabel } from './prompts'
import { StepBar } from './StepBar'
import type { RollShown } from './useGame'

export function RollCard({
  shown,
  state,
  human,
  onInspect,
}: {
  shown: RollShown
  state: GameState
  human: PlayerId
  onInspect: (unitId: string) => void
}) {
  const { step } = shown
  const { title, total } = headingOf(step, state, human)
  const more = shown.of - shown.number
  return (
    <div className="roll-card">
      {step.exchange !== undefined && <StepBar exchange={step.exchange} />}
      <div className="roll-card-head">
        <p className="roll-card-title">{title}</p>
        {total !== null && (
          <span className="roll-card-total">
            <b>{total.n}</b> {total.of}
          </span>
        )}
      </div>
      <div className="roll-card-body">
        <StepBody step={step} state={state} human={human} onInspect={onInspect} />
        <SaiLines lines={saiLines(step)} />
      </div>
      <div className="roll-card-foot">
        {more > 0 && (
          <button type="button" className="choice secondary minor" onClick={shown.skip}>
            Skip {more} more
          </button>
        )}
        {/* Focused, so Enter or Space steps through without hunting for the button. */}
        <button type="button" className="choice" onClick={shown.next} autoFocus>
          Continue
        </button>
      </div>
    </div>
  )
}

interface Heading {
  readonly title: string
  /** "9 melee": the number the card is about, beside its heading. */
  readonly total: { readonly n: number; readonly of: string } | null
}

/** "at Your home", "at the Frontier", "in Reserves": where, as a phrase. */
export function atPlace(slot: ArmyRef, human: PlayerId): string {
  if (slot === 'reserve') return 'in Reserves'
  const label = slotLabel(slot, human)
  return label === 'Your home' ? `at ${label}` : `at the ${label}`
}

/** A terrain as the object of a verb: "Your home", "the Frontier". */
function place(slot: ArmyRef, human: PlayerId): string {
  return atPlace(slot, human).replace(/^(at|in) /, '')
}

/** Whose roll this is, what for and where -- and the number it came to. */
export function headingOf(step: RollStep, state: GameState, human: PlayerId): Heading {
  const who = (player: PlayerId) => (player === human ? 'You' : 'The enemy')
  const whose = (player: PlayerId) => (player === human ? 'Your' : 'The enemy’s')
  const rolls = (player: PlayerId) => `${who(player)} ${player === human ? 'roll' : 'rolls'}`
  const at = (slot: ArmyRef) => atPlace(slot, human)
  const opp = (player: PlayerId): PlayerId => (player === 'p1' ? 'p2' : 'p1')
  const none = (title: string): Heading => ({ title, total: null })
  const where = step.exchange === undefined ? '' : ` ${at(step.exchange.slot)}`

  switch (step.kind) {
    case 'attack': {
      const { entry } = step
      const what = entry.isCounter
        ? entry.action === 'missile'
          ? 'a defensive volley'
          : 'a counter-attack'
        : entry.action
      const ends =
        entry.attackerSlot === entry.defenderSlot
          ? at(entry.defenderSlot)
          : `from ${place(entry.attackerSlot, human)} ${at(entry.defenderSlot)}`
      return { title: `${rolls(entry.attacker)} ${what} ${ends}`, total: { n: entry.attackTotal, of: entry.action } }
    }
    case 'resist': {
      const { entry } = step
      if (step.outcomeOnly === true || entry.saveDice === null) {
        return {
          title: `${step.outcomeOnly === true ? 'What it came to' : 'No save roll'} ${at(entry.defenderSlot)}`,
          total: { n: entry.damage, of: 'damage' },
        }
      }
      const saves = entry.defender === human ? 'You save' : 'The enemy saves'
      return {
        title: `${saves}${entry.charge === undefined ? '' : ' and strike back'} ${at(entry.defenderSlot)}`,
        total: entry.saveTotal === null ? null : { n: entry.saveTotal, of: 'saves' },
      }
    }
    case 'maneuver': {
      const marcher = marcherOf(step.entry, ownerIn(state))
      return {
        title: marcher === undefined ? 'The maneuver roll' : `${rolls(marcher)} to turn ${place(step.entry.slot, human)}`,
        total: { n: step.entry.marcher, of: 'maneuver' },
      }
    }
    case 'counter_maneuver': {
      const marcher = marcherOf(step.entry, ownerIn(state))
      return {
        title:
          marcher === undefined
            ? 'The opposing maneuver roll'
            : `${rolls(opp(marcher))} to stop it ${at(step.entry.slot)}`,
        total: { n: step.entry.defender, of: 'maneuver' },
      }
    }
    case 'sai': {
      const owner = state.units[step.die.unitId]?.owner
      const name = step.die.face.icon === 'SAI' ? step.die.face.sai : unitType(step.die.typeId).name
      return none(owner === undefined ? `${name}${where}` : `${whose(owner)} ${name}${where}`)
    }
    case 'spells': {
      const first = step.entries[0]
      const caster = first !== undefined && 'player' in first ? first.player : null
      const cantrip = step.exchange !== undefined && step.exchange.kind !== 'magic'
      // Not "The enemy casts": every line under it already says that.
      return none(caster === null ? 'Spells' : `${whose(caster)} ${cantrip ? 'Cantrip spells' : 'spells'}`)
    }
    case 'losses':
      return none(`${whose(step.entry.player)} losses ${at(step.entry.slot)}`)
    case 'live': {
      const { roll } = step.roll
      const n = roll.total
      const total = (of: string) => (n === undefined ? null : { n, of })
      switch (step.roll.kind) {
        case 'attack': {
          // A counter is named as one: the table roll carries only the action.
          const kind = step.exchange?.kind
          const what =
            kind === 'counter' ? 'a counter-attack' : kind === 'volley' ? 'a defensive volley' : step.roll.action ?? 'an attack'
          return { title: `${rolls(step.roll.player)} ${what}${where}`, total: total(step.roll.action ?? '') }
        }
        case 'save':
          return { title: `${step.roll.player === human ? 'You save' : 'The enemy saves'}${where}`, total: total('saves') }
        case 'maneuver':
          return step.roll.player === state.turn.marching
            ? {
                title: `${rolls(step.roll.player)} to turn ${step.exchange === undefined ? 'the terrain' : place(step.exchange.slot, human)}`,
                total: total('maneuver'),
              }
            : { title: `${rolls(step.roll.player)} to stop it${where}`, total: total('maneuver') }
        case 'dragon':
          return { title: `${whose(step.roll.player)} army answers the dragons${where}`, total: null }
      }
    }
    case 'roll':
      return wholeRollHeading(step.entry, human)
  }
}

/** A roll nobody resists, named for what it is and where. */
function wholeRollHeading(entry: LogEntry, human: PlayerId): Heading {
  const who = (player: PlayerId) => (player === human ? 'You' : 'The enemy')
  const whose = (player: PlayerId) => (player === human ? 'Your' : 'The enemy’s')
  const at = (slot: ArmyRef) => atPlace(slot, human)
  const none = (title: string): Heading => ({ title, total: null })
  switch (entry.kind) {
    case 'roll_off':
    case 'order_of_play':
      return none('The Horde roll-off')
    case 'magic_rolled':
      return {
        title: `${who(entry.player)} ${entry.player === human ? 'roll' : 'rolls'} magic ${at(entry.slot)}`,
        total: { n: entry.total, of: 'magic' },
      }
    case 'sai_sub_roll':
      return none(`Rolling to survive ${entry.source} ${at(entry.slot)}`)
    case 'confused':
      return none(`Confused dice roll again ${at(entry.slot)}`)
    case 'spell_saves':
      return { title: `${whose(entry.player)} saves against ${entry.source} ${at(entry.slot)}`, total: { n: entry.saves, of: 'saves' } }
    case 'thorns':
      return none('Wall of Thorns')
    case 'replanting':
      return none(`${whose(entry.player)} Replanting ${at(entry.slot)}`)
    case 'units_risen':
      return none('Rise from the Ashes')
    case 'dragon_attack':
      return none(`The dragons attack ${at(entry.slot)}`)
    case 'dragon_roll':
      return none(`${whose(entry.player)} army answers the dragons ${at(entry.slot)}`)
    default:
      return none('A roll')
  }
}

function StepBody({
  step,
  state,
  human,
  onInspect,
}: {
  step: RollStep
  state: GameState
  human: PlayerId
  onInspect: (unitId: string) => void
}) {
  switch (step.kind) {
    case 'roll':
      return <LogLine entry={step.entry} state={state} human={human} />
    case 'attack':
      return (
        <div className="log-roll">
          <CombatPart entry={step.entry} part="attack" human={human} head={false} />
        </div>
      )
    case 'resist':
      return (
        <div className="log-roll">
          {step.outcomeOnly !== true && <CombatPart entry={step.entry} part="saves" human={human} head={false} />}
          <CombatPart entry={step.entry} part="outcome" human={human} />
        </div>
      )
    case 'maneuver':
      return (
        <div className="log-roll">
          <ManeuverPart entry={step.entry} part="maneuver" human={human} head={false} />
        </div>
      )
    case 'counter_maneuver':
      return (
        <div className="log-roll">
          <ManeuverPart
            entry={step.entry}
            part="opposing"
            human={human}
            head={false}
            {...withMarcher(marcherOf(step.entry, ownerIn(state)))}
          />
        </div>
      )
    // One die and what it did, in the words the roll strip's tooltip already uses, then
    // the log's own lines for what it resolved: the targets, a sub-roll, an effect.
    case 'sai': {
      const { die } = step
      const name = die.face.icon === 'SAI' ? die.face.sai : die.face.icon.toLowerCase()
      return (
        <>
          <div className="roll-card-sai">
            <RollStrip dice={[die]} onInspect={onInspect} />
            <span>
              <b>{name}</b> ({unitType(die.typeId).name}): {effectSummary(die.effects ?? [], saiName(die.face))}
            </span>
          </div>
          {step.resolved.map((entry, i) => (
            <LogLine key={i} entry={entry} state={state} human={human} />
          ))}
        </>
      )
    }
    // A roll someone is deciding about, as it landed: the SAI faces are marked on the
    // strip, and the decision that follows says what they do. Its total is in the
    // heading now; the strip keeps the arithmetic.
    case 'live': {
      const { roll } = step.roll
      return (
        <div className="log-roll">
          <RollStrip
            dice={roll.dice}
            {...(roll.total === undefined ? {} : { total: roll.total })}
            {...(roll.math === undefined ? {} : { math: roll.math })}
            onInspect={onInspect}
          />
        </div>
      )
    }
    // Each spell and what it did -- and so where it went, since `spell_cast` itself
    // does not say: "Stone Skin settles on the enemy army at Enemy home".
    case 'spells':
      return (
        <div className="roll-card-spells">
          {step.entries.map((entry, i) => (
            <LogLine key={i} entry={entry} state={state} human={human} />
          ))}
        </div>
      )
    case 'losses':
      return <LogLine entry={step.entry} state={state} human={human} />
  }
}

/**
 * One line for each SAI die on a card (v2 Phase 9d): "★ Flame 2 · Gorgon — 2
 * health-worth killed and buried · next". The die in the strip was only a border; the
 * tooltip knew what it did and the card did not. The words are `effectSummary`'s, the
 * roll strip's own, and the tag is the exchange's chip for that SAI: what resolves next,
 * what is waiting behind it, what is done. An SAI that only changes the numbers --
 * Smite, Counter -- has no chip and no tag: it is already in the total.
 */
export interface SaiLine {
  readonly sai: string
  readonly count: number
  readonly unit: string
  readonly does: string
  readonly when?: 'next' | 'waiting' | 'now' | 'done'
}

/** The dice a card draws as its own roll, whose SAIs it owes a line each. */
function cardDice(step: RollStep): readonly DieRoll[] {
  switch (step.kind) {
    case 'attack':
      return step.entry.attackDice
    case 'resist':
      return step.outcomeOnly === true ? [] : (step.entry.saveDice ?? [])
    case 'maneuver':
      return step.entry.marcherDice
    case 'counter_maneuver':
      return step.entry.defenderDice
    case 'live':
      return step.roll.roll.dice
    case 'roll':
      return step.entry.kind === 'magic_rolled' ? step.entry.dice : []
    // The SAI's own card says it already; the rest roll no SAI worth a line.
    default:
      return []
  }
}

/** Where an SAI stands in its exchange, read off the bar's chips. */
function whenOf(exchange: Exchange | undefined, sai: string): SaiLine['when'] {
  const chips = exchange?.chips ?? []
  const chip = chips.find((one) => one.name === sai)
  if (chip === undefined) return undefined
  if (chip.state !== 'waiting') return chip.state
  return chips.find((one) => one.state === 'waiting') === chip && !chips.some((one) => one.state === 'now')
    ? 'next'
    : 'waiting'
}

export function saiLines(step: RollStep): readonly SaiLine[] {
  return cardDice(step).flatMap((die): SaiLine[] => {
    if (die.face.icon !== 'SAI') return []
    const does = effectSummary(die.effects ?? [], saiName(die.face))
    if (does === null) return []
    const when = whenOf(step.exchange, die.face.sai)
    return [
      {
        sai: die.face.sai,
        count: die.face.count,
        unit: unitType(die.typeId).name,
        does,
        ...(when === undefined ? {} : { when }),
      },
    ]
  })
}

function SaiLines({ lines }: { lines: readonly SaiLine[] }) {
  if (lines.length === 0) return null
  return (
    <>
      {lines.map((line, i) => (
        <p className="sai-line" key={i}>
          <span className="sai-star" aria-hidden="true">
            ★
          </span>
          <span>
            <b>
              {line.sai} {line.count}
            </b>{' '}
            · {line.unit} — {line.does}
          </span>
          {line.when !== undefined && <em className={`sai-when is-${line.when}`}>{line.when}</em>}
        </p>
      ))}
    </>
  )
}

/** `marcher` only when known: `exactOptionalPropertyTypes` takes no `undefined`. */
const withMarcher = (marcher: PlayerId | undefined): { marcher?: PlayerId } =>
  marcher === undefined ? {} : { marcher }
