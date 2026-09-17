/**
 * The running account of the game.
 *
 * Roll results get their own treatment -- the dice that landed, then the arithmetic
 * -- because a player has to be able to trust the app's maths, and watching it is
 * also how the rules get learned.
 */

import { Fragment, type ReactElement } from 'react'


import { unitType } from '../../data/load'
import { saiPhrase, saisBehind } from '../../engine/roll'


import {
  TERRAIN_SLOTS,
  type GameState,
  type LogEntry,
  type PlayerId,
  type TerrainSlot,
} from '../../engine/types'


import { RollStrip } from './DiceGrid'
import { speciesInfo } from './Elements'
import { slotLabel } from './prompts'

/** "melee" -> "Melee". The action reads as a name in a sentence, not a keyword. */
function actionName(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

/** Every die a combat entry rolled, both ends of the exchange. */
const allDice = (entry: Extract<LogEntry, { kind: 'combat_resolved' }>) => [
  ...entry.attackDice,
  ...(entry.saveDice ?? []),
]

const namesIn = (
  entry: Extract<LogEntry, { kind: 'combat_resolved' }>,
  kind: 'riposte' | 'unsavable',
): string | null => saiPhrase(allDice(entry), kind)

const plural = (
  entry: Extract<LogEntry, { kind: 'combat_resolved' }>,
  kind: 'riposte' | 'unsavable',
): boolean => saisBehind(allDice(entry), kind).length > 1


/**
 * The return type is written out rather than inferred so that a new `LogEntry` kind
 * is a compile error here. Without it the switch just falls off the end and returns
 * `undefined`, which React renders as a crash rather than as nothing.
 */
function Line({
  entry,
  state,
  human,
}: {
  entry: LogEntry
  state: GameState
  human: PlayerId
}): ReactElement | null {
  const who = (player: PlayerId) => (player === human ? 'You' : 'The enemy')
  const whoLower = (player: PlayerId) => (player === human ? 'you' : 'the enemy')
  const where = (slot: TerrainSlot) => slotLabel(slot, human)
  const verb = (player: PlayerId, singular: string, plural: string) =>
    player === human ? plural : singular

  switch (entry.kind) {
    case 'order_of_play': {
      const outcome = (
        <>
          {entry.rolls[human]} vs {entry.rolls[human === 'p1' ? 'p2' : 'p1']} maneuver;{' '}
          <b>
            {whoLower(entry.firstPlayer)} {verb(entry.firstPlayer, 'marches', 'march')} first
          </b>
        </>
      )
      // Repeated ties fall through to a coin flip, which has no dice to show.
      if (entry.dice[human].length === 0) {
        return <p className="log-line muted">Horde roll-off &mdash; {outcome}</p>
      }
      return (
        <div className="log-roll">
          <div className="roll-head">horde roll-off</div>
          <RollStrip dice={entry.dice[human]} />
          <div className="roll-head">the enemy&rsquo;s horde</div>
          <RollStrip dice={entry.dice[human === 'p1' ? 'p2' : 'p1']} />
          <div className="roll-sum">{outcome}</div>
        </div>
      )
    }
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
        <div className="log-roll">
          <div className="roll-head">maneuver</div>
          <RollStrip dice={entry.marcherDice} />
          <div className="roll-head">opposing maneuver</div>
          <RollStrip dice={entry.defenderDice} />
          <div className="roll-sum">
            {entry.marcher} vs {entry.defender} maneuver;{' '}
            <b>{entry.marcherWins ? 'the marcher wins' : 'the marcher loses'}</b>
          </div>
        </div>
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
      // "at <terrain>" when the attack lands where it stands, "from X to Y" when it
      // crosses. Never a bare "at" on a missile: that is the shape that read as the
      // target while naming the origin.
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'does', 'do')} a <b>{actionName(entry.action)}</b>{' '}
          attack{' '}
          {entry.fromSlot === entry.toSlot ? (
            <>at {where(entry.fromSlot)}</>
          ) : (
            <>
              from {where(entry.fromSlot)} to {where(entry.toSlot)}
            </>
          )}
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
          {/* Name both ends whenever they differ — a missile shot across the board,
              or a counter coming back the other way. Melee and magic hit the army in
              front of them, so repeating one terrain twice would be noise. */}
          <div className="roll-head">
            {entry.isCounter ? 'counter-attack' : entry.action}
            {entry.attackerSlot === entry.defenderSlot ? (
              <> · {where(entry.defenderSlot)}</>
            ) : (
              <>
                {' · '}
                {where(entry.attackerSlot)} &rarr; {where(entry.defenderSlot)}
              </>
            )}
          </div>
          <RollStrip dice={entry.attackDice} />
          {entry.saveDice !== null && (
            <>
              <div className="roll-head">saves</div>
              <RollStrip dice={entry.saveDice} />
            </>
          )}
          {/* The SAI is named, not just its arithmetic. "3 melee - 11 saves = 0
              damage and 4 straight back" is a correct sum that explains nothing:
              which die did that, and why is it not saveable? The names come off the
              dice above, where `resolveRoll` stamped them. */}
          <div className="roll-sum">
            {entry.saveTotal === null
              ? `${entry.attackTotal} ${entry.action}${entry.action === 'magic' ? ' ÷ 2' : ''}`
              : `${entry.attackTotal} ${entry.action} − ${entry.saveTotal} saves`}
            {entry.unsavable !== undefined && (
              <>
                {' + '}
                {entry.unsavable} unsavable
                {namesIn(entry, 'unsavable') === null ? '' : ` from ${namesIn(entry, 'unsavable')}`}
              </>
            )}
            {' = '}
            <b>{entry.damage}</b> damage
          </div>
          {entry.riposte !== undefined && (
            <div className="roll-sum">
              {namesIn(entry, 'riposte') === null ? (
                <>
                  and <b>{entry.riposte}</b> straight back, which no save can stop
                </>
              ) : (
                <>
                  <b>{namesIn(entry, 'riposte')}</b> {plural(entry, 'riposte') ? 'send' : 'sends'}{' '}
                  <b>{entry.riposte}</b> straight back, which no save can stop
                </>
              )}
            </div>
          )}

        </div>
      )

    case 'counter_suppressed':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'is', 'are')} taken by <b>Surprise</b> and cannot
          counter-attack

        </p>
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
    case 'units_risen':
      return (
        <p className="log-line big">
          {entry.unitIds
            .map((id) => {
              const unit = state.units[id]
              return unit ? unitType(unit.typeId).name : id
            })
            .join(', ')}{' '}
          rises from the ashes into {entry.player === human ? 'your' : "the enemy's"} reserves

        </p>
      )
    // Logged before the kill it causes: without it a Flame reads as dice dying from
    // nowhere, which is the Fireshadow-that-Smote-for-4 problem from Phase 1.
    case 'sai_resolved':
      return (
        <p className="log-line">
          <strong>{entry.sai}</strong> targets{' '}
          {entry.unitIds
            .map((id) => {
              const unit = state.units[id]
              return unit ? unitType(unit.typeId).name : id
            })
            .join(', ')}{' '}
          at {slotLabel(entry.slot, human)}
        </p>
      )
    case 'units_buried':
      return (
        <p className="log-line kill">
          {entry.unitIds
            .map((id) => {
              const unit = state.units[id]
              return unit ? unitType(unit.typeId).name : id
            })
            .join(', ')}{' '}
          {entry.unitIds.length === 1 ? 'is' : 'are'} buried — no resurrection
        </p>
      )
    case 'effects_expired':
      return (
        <p className="log-line muted">
          {entry.sources.join(', ')} wears off at the start of{' '}
          {entry.player === human ? 'your' : "the enemy's"} turn
        </p>
      )
    case 'counter_declined':
      return (
        <p className="log-line muted">

          {who(entry.player)} {verb(entry.player, 'declines', 'decline')} to counter
        </p>
      )
    case 'reinforced': {
      // One Reinforce Step can now split a reserve across terrains, so "reinforces
      // from reserve" stopped being the whole story: which dice went where is the
      // decision, and the board shows only the result.
      const groups = TERRAIN_SLOTS.map((slot) => ({
        slot,
        names: entry.moves
          .filter((move) => move.slot === slot)
          .map((move) => {
            const unit = state.units[move.unitId]
            return unit ? unitType(unit.typeId).name : move.unitId
          }),
      })).filter((group) => group.names.length > 0)

      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'reinforces', 'reinforce')}{' '}
          {groups.map((group, i) => (
            <Fragment key={group.slot}>
              {i > 0 && (i === groups.length - 1 ? ' and ' : ', ')}
              {where(group.slot)} with {group.names.join(', ')}
            </Fragment>
          ))}
        </p>
      )
    }

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
    case 'forces_drawn': {
      const named = (player: PlayerId) =>
        speciesInfo(entry.species[player])?.name ?? entry.species[player]
      return (
        <p className="log-line muted">
          Forces rolled &mdash; {entry.health} health a side. You are{' '}
          <b>{named(human)}</b>, the enemy is <b>{named(human === 'p1' ? 'p2' : 'p1')}</b>.
        </p>
      )
    }
    case 'game_start':
    case 'terrain_placed':
      return null
  }
}

export function LogPanel({ state, human }: { state: GameState; human: PlayerId }) {
  /*
   * Newest first.
   *
   * Beside the board the log is its own scroll pane, and a pane that grows downwards
   * has to be chased: pin after every commit, again when late face art changes the
   * height, again when the grid row resolves -- and back off the moment the player
   * scrolls up to read. Every one of those is a thing to get wrong.
   *
   * Reversing removes the problem instead of managing it. The entry you want is at
   * the top, which is where an unscrolled pane already is, so there is no scrolling
   * to do and nothing to keep in sync. Reversed here rather than with
   * `flex-direction: column-reverse` so the DOM order matches the visual one and a
   * screen reader reads what the eye sees.
   */
  return (
    <div className="log">
      {state.log
        .map((entry, i) => <Line key={i} entry={entry} state={state} human={human} />)
        .reverse()}
    </div>
  )
}
