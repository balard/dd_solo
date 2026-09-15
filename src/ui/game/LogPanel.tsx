/**
 * The running account of the game.
 *
 * Roll results get their own treatment -- the dice that landed, then the arithmetic
 * -- because a player has to be able to trust the app's maths, and watching it is
 * also how the rules get learned.
 */
import { useEffect, useRef } from 'react'

import { unitType } from '../../data/load'
import type { GameState, LogEntry, PlayerId, TerrainSlot } from '../../engine/types'

import { RollStrip } from './DiceGrid'
import { slotLabel } from './prompts'

function Line({ entry, state, human }: { entry: LogEntry; state: GameState; human: PlayerId }) {
  const who = (player: PlayerId) => (player === human ? 'You' : 'The enemy')
  const whoLower = (player: PlayerId) => (player === human ? 'you' : 'the enemy')
  const where = (slot: TerrainSlot) => slotLabel(slot, human)
  const verb = (player: PlayerId, singular: string, plural: string) =>
    player === human ? plural : singular

  switch (entry.kind) {
    case 'order_of_play':
      return (
        <p className="log-line muted">
          Horde roll-off {entry.rolls.p1} to {entry.rolls.p2}: {whoLower(entry.firstPlayer)}{' '}
          {verb(entry.firstPlayer, 'marches', 'march')} first
        </p>
      )
    case 'march_begin':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'marches', 'march')} at{' '}
          {where(entry.army as TerrainSlot)}
        </p>
      )
    case 'march_skipped':
      return (
        <p className="log-line muted">
          {who(entry.player)} {verb(entry.player, 'skips', 'skip')} a march
        </p>
      )
    case 'maneuver_declared':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'declares', 'declare')} a maneuver at{' '}
          {where(entry.slot)}
        </p>
      )
    case 'maneuver_allowed':
      return <p className="log-line muted">unopposed</p>
    case 'maneuver_contested':
      return (
        <p className="log-line">
          contested &mdash; {entry.marcher} vs {entry.defender} maneuver;{' '}
          <b>{entry.marcherWins ? 'the marcher wins' : 'the marcher loses'}</b>
        </p>
      )
    case 'terrain_moved':
      return (
        <p className="log-line">
          {where(entry.slot)} turns {entry.from} to <b>{entry.to}</b>
        </p>
      )
    case 'terrain_captured':
      return (
        <p className="log-line big">
          {where(entry.slot)} captured by {whoLower(entry.by)}
        </p>
      )
    case 'terrain_lost':
      return (
        <p className="log-line warn">
          {who(entry.from)} {verb(entry.from, 'loses', 'lose')} {where(entry.slot)} ({entry.reason})
        </p>
      )
    case 'action_chosen':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'attacks', 'attack')} with <b>{entry.action}</b> at{' '}
          {where(entry.slot)}
        </p>
      )
    case 'action_skipped':
      return (
        <p className="log-line muted">
          {who(entry.player)} {verb(entry.player, 'takes', 'take')} no action
        </p>
      )

    case 'combat_resolved':
      return (
        <div className="log-roll">
          <div className="roll-head">{entry.isCounter ? 'counter-attack' : entry.action}</div>
          <RollStrip dice={entry.attackDice} />
          {entry.saveDice !== null && (
            <>
              <div className="roll-head">saves</div>
              <RollStrip dice={entry.saveDice} />
            </>
          )}
          <div className="roll-sum">
            {entry.saveTotal === null
              ? `${entry.attackTotal} ${entry.action}${entry.action === 'magic' ? ' ÷ 2' : ''}`
              : `${entry.attackTotal} ${entry.action} − ${entry.saveTotal} saves`}
            {' = '}
            <b>{entry.damage}</b> damage
          </div>
        </div>
      )

    case 'units_killed':
      return (
        <p className="log-line kill">
          {who(entry.player)} {verb(entry.player, 'loses', 'lose')}{' '}
          {entry.unitIds
            .map((id) => {
              const unit = state.units[id]
              return unit ? unitType(unit.typeId).name : id
            })
            .join(', ')}
        </p>
      )
    case 'counter_declined':
      return (
        <p className="log-line muted">
          {who(entry.player)} {verb(entry.player, 'declines', 'decline')} to counter
        </p>
      )
    case 'reinforced':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'reinforces', 'reinforce')} from reserve
        </p>
      )
    case 'retreated':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'pulls', 'pull')} {entry.unitIds.length} unit
          {entry.unitIds.length === 1 ? '' : 's'} back to reserve
        </p>
      )
    case 'turn_end':
      return <hr className="log-turn" />
    case 'victory':
      return (
        <p className="log-line big">
          {entry.player === human ? 'You win' : 'You lose'} &mdash; by {entry.reason}
        </p>
      )
    case 'game_start':
    case 'terrain_placed':
      return null
  }
}

export function LogPanel({ state, human }: { state: GameState; human: PlayerId }) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [state.log.length])

  return (
    <div className="log">
      {state.log.map((entry, i) => (
        <Line key={i} entry={entry} state={state} human={human} />
      ))}
      <div ref={bottom} />
    </div>
  )
}
