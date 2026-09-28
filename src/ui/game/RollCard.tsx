/**
 * One roll, shown before the game moves on (v2 Phase 3c): the dice, then Continue.
 *
 * It takes the decision's place in the floating dialog, so the player's eye is in one
 * spot for the whole exchange: the attacker's dice, any SAI that fired, the resisting
 * roll with what they came to, then the question those rolls lead to. Every part is
 * drawn with the log's own pieces (`CombatPart`, `ManeuverPart`, `LogLine`), so the card
 * and the log cannot show one roll two ways.
 */
import { unitType } from '../../data/load'
import type { GameState, LogEntry, PlayerId } from '../../engine/types'

import { RollStrip, effectSummary } from './DiceGrid'
import { CombatPart, LogLine, ManeuverPart } from './LogPanel'
import type { RollStep } from './presentation'
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
  return (
    <div className="roll-card">
      <p className="roll-card-title">{titleOf(step, state, human)}</p>
      <div className="roll-card-body">
        <StepBody step={step} state={state} human={human} onInspect={onInspect} />
      </div>
      <div className="roll-card-foot">
        <span className="muted">
          roll {shown.number} of {shown.of}
        </span>
        {shown.of - shown.number > 0 && (
          <button type="button" className="choice secondary minor" onClick={shown.skip}>
            Skip {shown.of - shown.number} more
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

/** Whose roll this is, in a few words. The dice and the numbers are the body's job. */
function titleOf(step: RollStep, state: GameState, human: PlayerId): string {
  const who = (player: PlayerId) => (player === human ? 'You' : 'The enemy')
  const whose = (player: PlayerId) => (player === human ? 'Your' : 'The enemy’s')
  switch (step.kind) {
    case 'attack':
      return `${who(step.entry.attacker)} ${step.entry.attacker === human ? 'roll' : 'rolls'} ${
        step.entry.isCounter ? 'a counter-attack' : `a ${step.entry.action} attack`
      }`
    case 'resist':
      return step.entry.saveDice === null
        ? 'What it comes to'
        : `${whose(step.entry.defender)} saves`
    case 'maneuver':
      return 'The maneuver roll'
    case 'counter_maneuver':
      return 'The opposing maneuver roll'
    case 'sai': {
      const owner = state.units[step.die.unitId]?.owner
      const name = unitType(step.die.typeId).name
      return owner === undefined ? name : `${whose(owner)} ${name}`
    }
    case 'spells': {
      const first = step.entries[0]
      const caster = first !== undefined && 'player' in first ? first.player : null
      // Not "The enemy casts": every line under it already says that.
      return caster === null ? 'Spells' : `${whose(caster)} spells`
    }
    case 'roll':
      return wholeRollTitle(step.entry, whose)
  }
}

/** A roll nobody resists, named for what it is. */
function wholeRollTitle(entry: LogEntry, whose: (player: PlayerId) => string): string {
  switch (entry.kind) {
    case 'roll_off':
    case 'order_of_play':
      return 'The Horde roll-off'
    case 'magic_rolled':
      return `${whose(entry.player)} magic roll`
    case 'sai_sub_roll':
      return 'Rolling to survive'
    case 'spell_saves':
      return 'Saves against a spell'
    case 'thorns':
      return 'Wall of Thorns'
    case 'replanting':
      return 'Replanting'
    case 'units_risen':
      return 'Rise from the Ashes'
    case 'dragon_attack':
      return 'The dragons attack'
    case 'dragon_roll':
      return `${whose(entry.player)} army answers the dragons`
    default:
      return 'A roll'
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
          <CombatPart entry={step.entry} part="attack" human={human} />
        </div>
      )
    case 'resist':
      return (
        <div className="log-roll">
          <CombatPart entry={step.entry} part="saves" human={human} />
          <CombatPart entry={step.entry} part="outcome" human={human} />
        </div>
      )
    case 'maneuver':
      return (
        <div className="log-roll">
          <ManeuverPart entry={step.entry} part="maneuver" />
        </div>
      )
    case 'counter_maneuver':
      return (
        <div className="log-roll">
          <ManeuverPart entry={step.entry} part="opposing" />
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
              <b>{name}</b>: {effectSummary(die.effects ?? [])}
            </span>
          </div>
          {step.resolved.map((entry, i) => (
            <LogLine key={i} entry={entry} state={state} human={human} />
          ))}
        </>
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
  }
}
