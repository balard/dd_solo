/**
 * The running account of the game.
 *
 * Roll results get their own treatment -- the dice that landed, then the arithmetic
 * -- because a player has to be able to trust the app's maths, and watching it is
 * also how the rules get learned.
 */

import { Fragment, type ReactElement } from 'react'


import { dragonDie, dragonName, unitType } from '../../data/load'
import { spell } from '../../data/spells'
import { BREATH_NAME, DRAGON_ICON_TEXT } from '../../engine/dragons'
import { saiPhrase, saisBehind } from '../../engine/roll'


import {
  TERRAIN_SLOTS,
  type ArmyRef,
  type GameState,
  type LogEntry,
  type PlayerId,
  type UnitId,
} from '../../engine/types'


import { RollStrip } from './DiceGrid'
import { DragonFaceArt } from './FaceArt'
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
/** A unit's name by id: the log carries ids, and a dead die still has a name. */
function nameOf(state: GameState, id: UnitId): string {
  const unit = state.units[id]
  return unit === undefined ? id : unitType(unit.typeId).name
}

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
  const where = (slot: ArmyRef) => slotLabel(slot, human)
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
          <RollStrip dice={entry.dice[human]} total={entry.rolls[human]} />
          <div className="roll-head">the enemy&rsquo;s horde</div>
          <RollStrip
            dice={entry.dice[human === 'p1' ? 'p2' : 'p1']}
            total={entry.rolls[human === 'p1' ? 'p2' : 'p1']}
          />
          <div className="roll-sum">{outcome}</div>
        </div>
      )
    }
    case 'march_begin':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'marches', 'march')} at{' '}
          {where(entry.army)}
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
          <RollStrip dice={entry.marcherDice} total={entry.marcher} />
          <div className="roll-head">opposing maneuver</div>
          <RollStrip dice={entry.defenderDice} total={entry.defender} />
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
      //
      // "action" rather than "attack" for magic, and in every ruleset: under
      // `magic: 'spells'` a magic action attacks nothing at all, and under the v0
      // house rule it is still the magic *action* that is being taken. Calling it an
      // attack was right only while magic was a melee variant.
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'does', 'do')} a <b>{actionName(entry.action)}</b>{' '}
          {entry.action === 'magic' ? 'action' : 'attack'}{' '}
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
          <RollStrip dice={entry.attackDice} total={entry.attackTotal} />
          {entry.saveDice !== null && (
            <>
              <div className="roll-head">saves</div>
              <RollStrip
                dice={entry.saveDice}
                {...(entry.saveTotal === null ? {} : { total: entry.saveTotal })}
              />
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
          {/* A save face in a melee attack is otherwise a number from nowhere: the
              strip shows a shield, the total counts it as melee, and only this line
              says why (Phase 8). */}
          {entry.flamingShields !== undefined && (
            <div className="roll-sum">
              <b>Flaming Shields</b> counts {entry.flamingShields}{' '}
              {entry.flamingShields === 1 ? 'save' : 'saves'} as melee
            </div>
          )}
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
    // Not a death: these dice rolled an ID on their way to the DUA and never got there,
    // so no kill line names them.
    case 'units_replanted':
      return (
        <p className="log-line big">
          <b>Replanting</b>:{' '}
          {entry.unitIds
            .map((id) => {
              const unit = state.units[id]
              return unit ? unitType(unit.typeId).name : id
            })
            .join(', ')}{' '}
          {entry.unitIds.length === 1 ? 'takes' : 'take'} root in{' '}
          {entry.player === human ? 'your' : "the enemy's"} reserves instead of dying
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
    /**
     * The sub-roll a Smother, a Seize or a Bullseye puts its targets through.
     *
     * The dice are shown for the same reason the combat rolls are: without them a die
     * survives or dies on a number nobody saw. An ID roll counts nothing, so its whole
     * strip reads as blanks -- which is honest, since what it produced is the face.
     */
    case 'sai_sub_roll': {
      const names = (ids: readonly UnitId[]) =>
        ids
          .map((id) => {
            const unit = state.units[id]
            return unit ? unitType(unit.typeId).name : id
          })
          .join(', ')
      const asked =
        entry.test === 'id' ? 'an ID icon' : entry.test === 'save' ? 'a save' : 'a maneuver'

      return (
        <div className="log-roll">
          <div className="roll-head">
            <strong>{entry.source}</strong> &middot; {asked} or die &middot; {where(entry.slot)}
          </div>
          <RollStrip dice={entry.dice} />
          <div className="roll-sum">
            {entry.escaped.length === 0 ? (
              <span className="muted">none get away</span>
            ) : (
              <>
                {names(entry.escaped)}{' '}
                {entry.toReserve === true
                  ? `escape${entry.escaped.length === 1 ? 's' : ''} to ${
                      entry.player === human ? 'your' : "the enemy's"
                    } reserves`
                  : `get${entry.escaped.length === 1 ? 's' : ''} away`}
              </>
            )}
          </div>
        </div>
      )
    }
    // "settles on", not "catches": the verb was written for Sleep and Galeforce, and
    // read as an ambush. Half the spells in Phase 7 are cast on your *own* army, where
    // "Stone Skin catches your army" says the opposite of what happened.
    case 'effect_cast': {
      const unit = entry.unitId === undefined ? undefined : state.units[entry.unitId]
      return (
        <p className="log-line">
          <strong>{entry.source}</strong> settles on{' '}
          {unit
            ? unitType(unit.typeId).name
            : entry.target === undefined
              ? slotLabel(entry.slot, human)
              : `${entry.target === human ? 'your' : 'the enemy'} army at ${slotLabel(entry.slot, human)}`}
          <span className="muted">
            {' '}
            — until the start of {entry.player === human ? 'your' : "the enemy's"} next turn
          </span>
        </p>
      )
    }
    /**
     * Wild Growth, both halves of it: what the budget bought and what it did not.
     *
     * A promotion is an exchange, so the line names both ends -- the die that went
     * down to the DUA and the one that came up in its place.
     */
    case 'units_promoted': {
      const grown = entry.pairs.map((pair) => (
        <Fragment key={pair.unitId}>
          {nameOf(state, pair.unitId)} &rarr; <b>{nameOf(state, pair.partnerId)}</b>{' '}
        </Fragment>
      ))
      return (
        <p className="log-line">
          <strong>{entry.sai}</strong>{' '}
          {entry.pairs.length > 0 ? grown : null}
          {entry.saveResults !== undefined && (
            <span className={entry.pairs.length > 0 ? 'muted' : ''}>
              {entry.pairs.length > 0 ? 'and ' : ''}
              {entry.saveResults} save results
            </span>
          )}
        </p>
      )
    }

    /** A free move: part of an army walking off mid-roll, results and all. */
    case 'units_moved':
      return (
        <p className="log-line">
          <strong>{entry.sai}</strong> walks{' '}
          {entry.unitIds.map((id) => nameOf(state, id)).join(', ')} from{' '}
          {where(entry.from)} to {where(entry.to)}
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
          {entry.source === 'temple' && <span className="muted"> (forced by the Temple)</span>}
        </p>
      )
    case 'units_recruited':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'recruits', 'recruit')}{' '}
          {entry.unitIds.map((id) => nameOf(state, id)).join(', ')} from the DUA to{' '}
          {where(entry.slot)}
        </p>
      )
    case 'effects_expired':
      return (
        <p className="log-line muted">
          {entry.sources.join(', ')} wears off at the start of{' '}
          {entry.player === human ? 'your' : "the enemy's"} turn
        </p>
      )
    // A magic roll under `magic: 'spells'` hits nothing -- its total is a pool of
    // casting points -- so it gets the roll strip an attack gets and none of the
    // damage arithmetic.
    case 'magic_rolled':
      return (
        <div className="log-roll">
          <div className="roll-head">magic at {where(entry.slot)}</div>
          <RollStrip dice={entry.dice} total={entry.total} />
          <div className="roll-sum">
            <b>{entry.total}</b> magic <span className="muted">({entry.elements.join(' or ')})</span>
          </div>
        </div>
      )

    case 'spell_cast':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'casts', 'cast')}{' '}
          <b>{spell(entry.spell).name}</b>
          {entry.count > 1 ? ` ×${entry.count}` : ''}{' '}
          <span className="muted">({entry.element})</span>
        </p>
      )

    case 'units_resurrected':
      return (
        <p className="log-line">
          {who(entry.player)} {verb(entry.player, 'raises', 'raise')}{' '}
          <b>
            {entry.unitIds
              .map((id) => (state.units[id] ? unitType(state.units[id]!.typeId).name : id))
              .join(', ')}
          </b>{' '}
          into the army at {slotLabel(entry.slot, human)}
        </p>
      )

    // Where it came from matters: the spell pulls a dragon off another terrain as
    // readily as out of a pool, and "it left the Frontier" is half the news.
    case 'dragon_summoned':
      return (
        <p className="log-line">
          <b>{dragonName(entry.dieId)}</b> is summoned to {slotLabel(entry.slot, human)}
          <span className="muted">
            {' '}
            {entry.from === 'pool'
              ? 'from the Summoning Pool'
              : `from ${slotLabel(entry.from, human)}`}
          </span>
        </p>
      )

    // Both numbers, because "the flood failed" and "the flood failed by one result"
    // are different things to read on your opponent's turn.
    case 'dispel_magic': {
      const who_ = state.units[entry.unitId]
        ? unitType(state.units[entry.unitId]!.typeId).name
        : entry.unitId
      return entry.spells.length === 0 ? (
        <p className="log-line muted">{who_} tries to dispel, and misses</p>
      ) : (
        <p className="log-line">
          <b>Dispel Magic</b> — {who_} stops{' '}
          {entry.spells.map((id) => spell(id).name).join(', ')}
        </p>
      )
    }

    case 'cantrip':
      return (
        <p className="log-line">
          <b>Cantrip</b> gives {who(entry.player)} {entry.points} magic{' '}
          <span className="muted">— cantrip spells only</span>
        </p>
      )

    case 'rapid_growth':
      return (
        <p className="log-line">
          <b>Rapid Growth</b>: {whoLower(entry.player)} {verb(entry.player, 'throws', 'throw')}{' '}
          {entry.unitIds
            .map((id) => (state.units[id] ? unitType(state.units[id]!.typeId).name : id))
            .join(', ')}{' '}
          again
        </p>
      )

    case 'flashfire':
      return (
        <p className="log-line">
          <b>Flashfire</b> throws{' '}
          {entry.unitIds
            .map((id) => (state.units[id] ? unitType(state.units[id]!.typeId).name : id))
            .join(', ')}{' '}
          again
        </p>
      )

    // An exchange, not a death: the die that would have gone to the DUA is in it, and
    // the small one it swapped with is on the board.
    case 'units_regrown':
      return (
        <p className="log-line">
          <b>Accelerated Growth</b>{' '}
          {entry.pairs
            .map(
              (pair) =>
                `${state.units[pair.unitId] ? unitType(state.units[pair.unitId]!.typeId).name : pair.unitId}` +
                ` \u2192 ${state.units[pair.partnerId] ? unitType(state.units[pair.partnerId]!.typeId).name : pair.partnerId}`,
            )
            .join(', ')}
        </p>
      )

    case 'flash_flood':
      return (
        <p className="log-line">
          <b>Flash Flood</b> at {where(entry.slot)} &mdash;{' '}
          {entry.moved ? 'the terrain goes down' : 'held'}
          <span className="muted">
            {' '}
            ({entry.resisted} of {entry.needed} maneuver)
          </span>
        </p>
      )

    case 'thorns':
      return (
        <div className="log-roll">
          <div className="roll-head">Wall of Thorns at {where(entry.slot)}</div>
          <RollStrip dice={entry.dice} total={entry.melee} />
          <div className="roll-sum">
            {entry.melee} melee &rarr; <b>{entry.damage}</b> damage
          </div>
          {entry.flamingShields !== undefined && (
            <div className="roll-sum">
              <b>Flaming Shields</b> counts {entry.flamingShields}{' '}
              {entry.flamingShields === 1 ? 'save' : 'saves'} as melee
            </div>
          )}
        </div>
      )

    // The roll that stands between a damaging spell and its damage. Drawn even when
    // it stops the spell dead: a Hailstorm that killed nobody and a Hailstorm that
    // was saved against look identical without it.
    case 'spell_saves':
      return (
        <div className="log-roll">
          <div className="roll-head">
            {entry.source} — {whoLower(entry.player)} {verb(entry.player, 'saves', 'save')} at{' '}
            {where(entry.slot)}
          </div>
          <RollStrip dice={entry.dice} total={entry.saves} />
          <div className="roll-sum">
            <b>{entry.saves}</b> saves
          </div>
        </div>
      )

    case 'spell_fizzled':
      return (
        <p className="log-line muted">
          {spell(entry.spell).name} fizzles — its target is gone
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
    // No Frontier seed under `magic: 'spells'`: every dragon waits in the pool for a
    // `Summon Dragon`, which is what the base rules say and what Phase 6 could not do.
    case 'dragons_drawn': {
      const frontier = entry.frontier
      return (
        <p className="log-line muted">
          {who(entry.player)} {verb(entry.player, 'brings', 'bring')}{' '}
          {entry.pool.map(dragonName).join(' and ')} &mdash;{' '}
          {frontier === undefined ? (
            <>they wait in the Summoning Pool</>
          ) : (
            <>
              <b>{dragonName(frontier)}</b> starts at the Frontier
            </>
          )}
        </p>
      )
    }

    /*
     * One line per dragon, not one per face.
     *
     * This read "Fire Wyrm breath, Fire Wyrm breath, Fire Wyrm tail, Fire Wyrm claw,
     * Earth Drake tail, Earth Drake claw" -- which repeats the name six times, hides
     * that four of those faces are one die rerolling itself, never says who was
     * being attacked, and never says what any of it came to.
     */
    case 'dragon_attack':
      return (
        <div className="log-roll">
          <div className="roll-head">
            dragon attack at {where(entry.slot)} &mdash; {whoLower(entry.defender)}{' '}
            {verb(entry.defender, 'is', 'are')} marching
          </div>
          {entry.dragons.map((dragon) => (
            <div className="dragon-roll" key={dragon.dragonId}>
              <span className={`dragon-roll-who dragon-el-${dragonDie(dragon.dieId).element}`}>
                <b>{dragonName(dragon.dieId)}</b>
                {' → '}
                {dragon.target.kind === 'army'
                  ? `${whoLower(entry.defender)}${entry.defender === human ? 'r' : ''} army`
                  : dragonName(dragon.target.dieId)}
              </span>
              {/* Its faces, drawn like the army's dice rather than spelled out --
                  and chained by arrows, because a tail rerolling into a claw is one
                  die thrown twice, not two dragons. */}
              <span className="roll-strip">
                {dragon.faces.map(({ face, icon }, i) => (
                  <Fragment key={i}>
                    {i > 0 && (
                      <span className="reroll-arrow" aria-hidden="true">
                        &rarr;
                      </span>
                    )}
                    <span
                      className={`rolled dragon-face dragon-el-${dragonDie(dragon.dieId).element}`}
                      title={`${icon.charAt(0)}${icon.slice(1).toLowerCase()} — ${
                        DRAGON_ICON_TEXT[icon]
                      }${i > 0 ? ' (rerolled)' : ''}`}
                    >
                      {/* 30px: the same floor the unit roll strip uses, and the
                          size at which the real art starts beating a glyph. */}
                      <DragonFaceArt dieId={dragon.dieId} face={face} icon={icon} size={30} />
                    </span>
                  </Fragment>
                ))}
              </span>
              {dragon.damage > 0 && <span className="muted">{dragon.damage} damage</span>}
            </div>
          ))}
        </div>
      )

    case 'dragon_breath':
      return (
        <p className="log-line">
          <b>{BREATH_NAME[entry.element]}</b> kills{' '}
          {entry.unitIds.map((id) => nameOf(state, id)).join(', ') || 'nothing'}
        </p>
      )

    case 'dragon_breath_effect':
      return (
        <p className="log-line muted">
          {BREATH_NAME[entry.element]} lingers on {whoLower(entry.player)}
          {"'"}s army at {where(entry.slot)} until {whoLower(entry.player)} next{' '}
          {verb(entry.player, 'takes', 'take')} a turn
        </p>
      )

    // A `div` wrapper, not a `p`: `RollStrip` is a block, and a div inside a
    // paragraph is invalid nesting that React only complains about at runtime.
    case 'dragon_roll':
      return (
        <div className="log-roll">
          <div className="roll-head">
            {who(entry.player)} {verb(entry.player, 'answers', 'answer')} the dragons
          </div>
          <RollStrip dice={entry.dice} />
          <div className="roll-sum">
            <b>{entry.totals.melee}</b> melee, <b>{entry.totals.missile}</b> missile,{' '}
            <b>{entry.totals.save}</b> save
          </div>
          {entry.flamingShields !== undefined && (
            <div className="roll-sum">
              <b>Flaming Shields</b> counts {entry.flamingShields}{' '}
              {entry.flamingShields === 1 ? 'save' : 'saves'} as melee
            </div>
          )}
        </div>
      )

    case 'dragon_home':
      return (
        <p className="log-line">
          {dragonName(entry.dieId)} {entry.why === 'slain' ? 'is slain' : 'flies away'} and returns
          to its Summoning Pool
        </p>
      )
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
