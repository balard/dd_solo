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
import { poolSplit } from '../../engine/magic'
import { BREATH_NAME, DRAGON_ICON_TEXT } from '../../engine/dragons'
import { mathPhrase, saiPhrase, saisBehind, spellSavedPhrase, type RollMath } from '../../engine/roll'


import {
  TERRAIN_SLOTS,
  type ArmyRef,
  type GameState,
  type DragonAnswer,
  type LogEntry,
  type PlayerId,
  type UnitId,
} from '../../engine/types'


import { RollStrip } from './DiceGrid'
import { logShows, type CombatEntry, type ManeuverEntry } from './presentation'
import { DragonFaceArt } from './FaceArt'
import { speciesInfo } from './Elements'
import { proposalLabel, slotLabel } from './prompts'

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

/** What failing a sub-roll costs: death, unless the entry says otherwise. */
const stakeOf = (fate: Extract<LogEntry, { kind: 'sai_sub_roll' }>['fate']): string => {
  switch (fate) {
    case 'bury':
      return 'be buried'
    case 'net':
      return 'be netted'
    case 'stun':
      return 'be stunned'
    case undefined:
      return 'die'
  }
}


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

/** One log entry, as the log draws it. Exported for the decision sheet, which shows
 *  the roll a decision answers with the same renderer (Phase 9d). */
export function LogLine({
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
    // v1 Phase 10e: the roll-off decides who *chooses*, and the choice is its own line.
    case 'roll_off': {
      const other = human === 'p1' ? 'p2' : 'p1'
      const outcome = (
        <>
          {entry.rolls[human]} vs {entry.rolls[other]} maneuver;{' '}
          <b>
            {whoLower(entry.winner)} {verb(entry.winner, 'chooses', 'choose')} the first turn or the Frontier
          </b>
        </>
      )
      if (entry.dice[human].length === 0) {
        return <p className="log-line muted">Horde roll-off &mdash; {outcome}</p>
      }
      return (
        <div className="log-roll">
          <div className="roll-head">horde roll-off</div>
          <RollStrip dice={entry.dice[human]} total={entry.rolls[human]} />
          <div className="roll-head">the enemy&rsquo;s horde</div>
          <RollStrip dice={entry.dice[other]} total={entry.rolls[other]} />
          <div className="roll-sum">{outcome}</div>
        </div>
      )
    }
    case 'roll_off_decided': {
      const frontier = <b>{proposalLabel(entry.frontier, entry.proposer, human)}</b>
      const loser = entry.winner === 'p1' ? 'p2' : 'p1'
      return entry.took === 'first_turn' ? (
        <p className="log-line">
          {who(entry.winner)} {verb(entry.winner, 'takes', 'take')} the first turn;{' '}
          {whoLower(loser)} {verb(loser, 'picks', 'pick')} the Frontier: {frontier}
        </p>
      ) : (
        <p className="log-line">
          {who(entry.winner)} {verb(entry.winner, 'picks', 'pick')} the Frontier: {frontier};{' '}
          {whoLower(entry.firstPlayer)} {verb(entry.firstPlayer, 'marches', 'march')} first
        </p>
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
    // In two parts, which the roll step-through (v2 Phase 3c) shows one at a time.
    case 'maneuver_contested':
      return (
        <div className="log-roll">
          <ManeuverPart entry={entry} part="maneuver" />
          <ManeuverPart entry={entry} part="opposing" />
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

    // In three parts, which the feed (v2 Phase 3c) draws as separate steps. Composed
    // here, so the log and the feed draw one exchange with the same pieces.
    case 'combat_resolved':
      return (
        <div className="log-roll">
          <CombatPart entry={entry} part="attack" human={human} />
          <CombatPart entry={entry} part="saves" human={human} />
          <CombatPart entry={entry} part="outcome" human={human} />
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
    // Every roll, the misses too: a Treefolk that rolled and failed used to leave no
    // trace, so "it tried" and "the rule never fired" looked the same. The ID dice are
    // the ones that made it; they never reached the DUA, and no kill line names them.
    case 'replanting': {
      const names = (ids: readonly string[]) =>
        ids.map((id) => (state.units[id] ? unitType(state.units[id]!.typeId).name : id)).join(', ')
      const missed = entry.dice.map((d) => d.unitId).filter((id) => !entry.rooted.includes(id))
      const theirs = entry.player === human ? 'your' : "the enemy's"
      return (
        <div className="log-roll">
          <div className="roll-head">Replanting · {where(entry.slot)}</div>
          <RollStrip dice={entry.dice} />
          <div className="roll-sum">
            {entry.rooted.length > 0 && (
              <>
                {names(entry.rooted)} rolled an ID and {entry.rooted.length === 1 ? 'takes' : 'take'}{' '}
                root in {theirs} reserves
              </>
            )}
            {entry.rooted.length > 0 && missed.length > 0 && '; '}
            {/* "Rolled no ID", not "and dies": since Phase 9b an Accelerated Growth may
                still take the die, and the kill or exchange line after this one says which. */}
            {missed.length > 0 && <>{names(missed)} rolled no ID</>}
          </div>
        </div>
      )
    }
    // Every roll, hits and misses (fix after Phase 9): a Phoenix that rolled and failed
    // used to leave no trace at all -- the Replanting silence, which Phase 8 noted here
    // and left.
    case 'units_risen': {
      const names = (ids: readonly string[]) =>
        ids.map((id) => (state.units[id] ? unitType(state.units[id]!.typeId).name : id)).join(', ')
      const missed = [...new Set((entry.dice ?? []).map((d) => d.unitId))].filter(
        (id) => !entry.unitIds.includes(id),
      )
      const theirs = entry.player === human ? 'your' : "the enemy's"
      return (
        <div className="log-roll">
          <div className="roll-head">Rise from the Ashes</div>
          {entry.dice !== undefined && <RollStrip dice={entry.dice} />}
          <div className="roll-sum">
            {entry.unitIds.length > 0 && (
              <b>
                {names(entry.unitIds)} {entry.unitIds.length === 1 ? 'rises' : 'rise'} from the ashes
                into {theirs} reserves
              </b>
            )}
            {entry.unitIds.length > 0 && missed.length > 0 && '; '}
            {missed.length > 0 && <>{names(missed)} rolled no Rise from the Ashes</>}
          </div>
        </div>
      )
    }
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
          {/* Roar (v2 Phase 6d): nothing follows this line, so it says where they went. */}
          {entry.toReserve === true && <span className="muted"> — sent to their reserves</span>}
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

      // A damage sub-roll (v2 Phase 6d: Bash, and Firebolt in 6g): not "any save gets
      // away" but saves against a number, so it says the number.
      if (entry.damage !== undefined) {
        return (
          <div className="log-roll">
            <div className="roll-head">
              <strong>{entry.source}</strong> &middot; saves against {entry.damage} damage &middot;{' '}
              {where(entry.slot)}
            </div>
            <RollStrip dice={entry.dice} />
            <div className="roll-sum">
              {entry.escaped.length > 0 ? (
                <>{names(entry.escaped)} survives</>
              ) : (
                <span className="muted">not enough saves</span>
              )}
            </div>
          </div>
        )
      }

      return (
        <div className="log-roll">
          <div className="roll-head">
            <strong>{entry.source}</strong> &middot; {asked} or {stakeOf(entry.fate)}{' '}
            &middot; {where(entry.slot)}
          </div>
          <RollStrip dice={entry.dice} />
          <div className="roll-sum">
            {entry.fate === 'bury' ? (
              // Already dead: a save keeps them in the DUA rather than getting them away.
              entry.escaped.length === 0 ? (
                <span className="muted">none save — all buried</span>
              ) : (
                <>
                  {names(entry.escaped)} {entry.escaped.length === 1 ? 'saves and stays' : 'save and stay'} in the
                  DUA
                </>
              )
            ) : entry.escaped.length === 0 ? (
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
          {entry.onDua === true
            ? `${entry.target === human ? 'your' : "the enemy's"} DUA`
            : unit
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
    // Regenerate (v2 Phase 7d): dice back from the DUA, or the saves taken instead.
    case 'units_regenerated':
      return (
        <p className={entry.unitIds.length === 0 && entry.saveResults === undefined ? 'log-line muted' : 'log-line'}>
          <strong>{entry.sai}</strong>:{' '}
          {entry.unitIds.length > 0 ? (
            <>
              {who(entry.player)} {verb(entry.player, 'brings', 'bring')}{' '}
              {entry.unitIds.map((id) => nameOf(state, id)).join(', ')} back from the DUA to{' '}
              {where(entry.slot)}
            </>
          ) : entry.saveResults !== undefined ? (
            <>
              {who(entry.player)} {verb(entry.player, 'takes', 'take')} {entry.saveResults} saves
            </>
          ) : (
            <>
              {who(entry.player)} {verb(entry.player, 'brings', 'bring')} nobody back
            </>
          )}
        </p>
      )
    // Scent of Fear (v2 Phase 7e): dice moved home by a spell, with no roll.
    case 'units_sent_home':
      return (
        <p className="log-line">
          <strong>{entry.source}</strong>: {entry.unitIds.map((id) => nameOf(state, id)).join(', ')}{' '}
          {entry.unitIds.length === 1 ? 'goes' : 'go'} back to {entry.player === human ? 'your' : "the enemy's"}{' '}
          reserves
        </p>
      )
    // Foul Stench (v2 Phase 7d): the defender's dice that sit the counter out.
    case 'foul_stench':
      return (
        <p className="log-line">
          <strong>Foul Stench</strong>:{' '}
          {entry.noCounter === true
            ? `none of ${entry.player === human ? 'your' : "the enemy's"} dice may counter-attack`
            : `${entry.unitIds.map((id) => nameOf(state, id)).join(', ')} may not counter-attack`}
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
          <RollStrip dice={entry.dice} total={entry.total} {...withMath(entry.math)} />
          <div className="roll-sum">
            <b>{entry.total}</b> magic{' '}
            <span className="muted">({poolSplit(entry.suppliers) ?? entry.elements.join(' or ')})</span>
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

    // Both faces, as they were and as they came back (Phase 9d). Without the "before"
    // the only strip left was the replaced one, which read as Confuse firing on the
    // attack roll that carried its face.
    case 'confused':
      return (
        <div className="log-roll">
          <div className="roll-head">
            <b>{entry.sai}</b> · {who(entry.player)} {verb(entry.player, 'makes', 'make')}{' '}
            {entry.target === human ? 'your' : "the enemy's"} saves roll again
          </div>
          <div className="confused-pair">
            <RollStrip dice={entry.before} />
            <span className="reroll-arrow" aria-label="became">&rarr;</span>
            <RollStrip dice={entry.after} />
          </div>
        </div>
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
          <RollStrip dice={entry.dice} total={entry.melee} {...withMath(entry.math)} />
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
          <RollStrip dice={entry.dice} total={entry.saves} {...withMath(entry.math)} />
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
    // Both ends, as an attack names both: "flew" alone would not say where the army
    // that just appeared at the Frontier came from.
    case 'air_flight':
      return (
        <p className="log-line">
          <b>Air Flight</b>:{' '}
          {entry.moves
            .map((move) => `${nameOf(state, move.unitId)} ${where(move.from)} → ${where(move.to)}`)
            .join(', ')}
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
        entry.species[player].map((id) => speciesInfo(id)?.name ?? id).join(' and ')
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
          {/* One line per type a modifier touched: a combination roll has three totals,
              and a halving breath or a Galeforce changes one of them, not "the roll". */}
          {DRAGON_KINDS.map((kind) => {
            const math = entry.math?.[kind]
            if (math === undefined) return null
            const phrase = mathPhrase(math, entry.totals[kind])
            return (
              <div className="roll-math" key={kind}>
                {kind}: {phrase}
                {math.notes.map((note) => (
                  <span key={note} className="muted">
                    {phrase === '' ? '' : ' · '}
                    {note}
                  </span>
                ))}
              </div>
            )
          })}
          {entry.flamingShields !== undefined && (
            <div className="roll-sum">
              <b>Flaming Shields</b> counts {entry.flamingShields}{' '}
              {entry.flamingShields === 1 ? 'save' : 'saves'} as melee
            </div>
          )}
        </div>
      )

    /*
     * The Dragon Attack Phase's subtraction (Phase 9c), both ways. Before this the log
     * showed what each side rolled and then who died, and "12 damage" against an army
     * that lost 8 health was left for the reader to reconcile.
     */
    case 'dragon_damage':
      return (
        <div className="log-roll">
          {entry.incoming !== undefined && (
            <div className="roll-sum">
              Dragons deal <b>{entry.incoming.inflicted}</b> damage − {entry.incoming.saves} saves
              {entry.incoming.bash !== undefined && <> − {entry.incoming.bash} Bash</>} ={' '}
              <b>{entry.incoming.damage}</b> damage to {entry.player === human ? 'your' : "the enemy's"} army at{' '}
              {where(entry.slot)}
            </div>
          )}
          {entry.bashed?.map((bash) => (
            <div className="roll-sum" key={`bash-${bash.dragonId}`}>
              <b>Bash</b> sends {bash.damage} back vs {bash.threshold} &rarr; {dragonLabel(state, bash.dragonId)}{' '}
              {bash.slain ? <b>is slain</b> : 'survives'}
            </div>
          ))}
          {entry.answered?.map((answer) => (
            <div className="roll-sum" key={answer.dragonId}>
              {answerPhrase(answer)} &rarr; {dragonLabel(state, answer.dragonId)}{' '}
              {answer.slain ? <b>is slain</b> : 'survives'}
            </div>
          ))}
          {entry.duels?.map((duel) => (
            <div className="roll-sum" key={duel.dragonId}>
              {dragonLabel(state, duel.dragonId)} deals <b>{duel.damage}</b> vs {duel.threshold} &rarr;{' '}
              {dragonLabel(state, duel.targetId)} {duel.slain ? <b>is slain</b> : 'survives'}
            </div>
          ))}
        </div>
      )

    case 'dragon_home':
      return (
        <p className="log-line">
          {dragonName(entry.dieId)} {entry.why === 'slain' ? 'is slain' : 'flies away'} and returns
          to its Summoning Pool
        </p>
      )
    // `logShows` names these two: keep the lists in step.
    case 'game_start':
    case 'terrain_placed':
      return null
  }
}

/** One side of a contested maneuver: the marcher's roll, or the opposing roll and who won. */
export function ManeuverPart({
  entry,
  part,
}: {
  entry: ManeuverEntry
  part: 'maneuver' | 'opposing'
}): ReactElement {
  return part === 'maneuver' ? (
    <>
      <div className="roll-head">maneuver</div>
      <RollStrip dice={entry.marcherDice} total={entry.marcher} {...withMath(entry.marcherMath)} />
    </>
  ) : (
    <>
      <div className="roll-head">opposing maneuver</div>
      <RollStrip dice={entry.defenderDice} total={entry.defender} {...withMath(entry.defenderMath)} />
      <div className="roll-sum">
        {entry.marcher} vs {entry.defender} maneuver;{' '}
        <b>{entry.marcherWins ? 'the marcher wins' : 'the marcher loses'}</b>
      </div>
    </>
  )
}

/** One part of a combat exchange: its attack roll, its save roll, or what they came to. */
export function CombatPart({
  entry,
  part,
  human,
}: {
  entry: CombatEntry
  part: 'attack' | 'saves' | 'outcome'
  human: PlayerId
}): ReactElement | null {
  const where = (slot: ArmyRef) => slotLabel(slot, human)
  switch (part) {
    case 'attack':
      return (
        <>
          {/* Name both ends whenever they differ — a missile shot across the board,
              or a counter coming back the other way. Melee and magic hit the army in
              front of them, so repeating one terrain twice would be noise. */}
          <div className="roll-head">
            {entry.isCounter ? (entry.action === 'missile' ? 'defensive volley' : 'counter-attack') : entry.action}
            {entry.attackerSlot === entry.defenderSlot ? (
              <> · {where(entry.defenderSlot)}</>
            ) : (
              <>
                {' · '}
                {where(entry.attackerSlot)} &rarr; {where(entry.defenderSlot)}
              </>
            )}
          </div>
          <RollStrip dice={entry.attackDice} total={entry.attackTotal} {...withMath(entry.attackMath)} />
        </>
      )
    case 'saves':
      return entry.saveDice === null ? null : (
        <>
          {/* A Charge's answer counts melee too (v2 Phase 6e). */}
          <div className="roll-head">{entry.charge === undefined ? 'saves' : 'saves and melee — charged'}</div>
          <RollStrip
            dice={entry.saveDice}
            {...(entry.saveTotal === null ? {} : { total: entry.saveTotal })}
            {...withMath(entry.saveMath)}
          />
        </>
      )
    case 'outcome':
      return (
        <>
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
          {/* What the dice sent, then what spells took off it (v2 Phase 6c): the
              attacking army rolls no saves, and only its spells' saves reduce this. */}
          {/* Charge (v2 Phase 6e): the combination roll's melee goes back, with any
              Counter's riposte, and there is no counter-attack. */}
          {entry.charge !== undefined && (
            <div className="roll-sum">
              <b>Charge</b>: {entry.charge.melee} melee straight back
              {(entry.riposteMath?.base ?? entry.riposte ?? 0) > entry.charge.melee && (
                <>
                  {' + '}
                  {(entry.riposteMath?.base ?? entry.riposte ?? 0) - entry.charge.melee}
                  {namesIn(entry, 'riposte') === null ? '' : ` from ${namesIn(entry, 'riposte')}`}
                </>
              )}
              {spellSavedPhrase(entry.riposteMath, entry.riposte ?? 0)}, with no save roll and no
              counter-attack
            </div>
          )}
          {entry.charge === undefined && (entry.riposte !== undefined || entry.riposteMath !== undefined) && (
            <div className="roll-sum">
              {namesIn(entry, 'riposte') === null ? (
                <>and </>
              ) : (
                <>
                  <b>{namesIn(entry, 'riposte')}</b> {plural(entry, 'riposte') ? 'send' : 'sends'}{' '}
                </>
              )}
              <b>{entry.riposteMath?.base ?? entry.riposte}</b> straight back
              {spellSavedPhrase(entry.riposteMath, entry.riposte ?? 0)}, with no save roll
            </div>
          )}
        </>
      )
  }
}

/** `math` only when the entry has one: `exactOptionalPropertyTypes` will not take an
 *  `undefined` for an optional prop. */
function withMath(math: RollMath | undefined): { math?: RollMath } {
  return math === undefined ? {} : { math }
}

const DRAGON_KINDS = ['melee', 'missile', 'save'] as const

/** "7 melee, 3 missile vs 10" -- the two are never combined, so both are shown against
 *  the one threshold. A type the army put nothing into is left out. */
function answerPhrase(answer: DragonAnswer): string {
  const parts = [
    ...(answer.melee > 0 ? [`${answer.melee} melee`] : []),
    ...(answer.missile > 0 ? [`${answer.missile} missile`] : []),
  ]
  return `${parts.length === 0 ? 'nothing' : parts.join(', ')} vs ${answer.threshold}`
}

function dragonLabel(state: GameState, dragonId: string): string {
  const dragon = state.dragons[dragonId]
  return dragon === undefined ? dragonId : dragonName(dragon.dieId)
}

/**
 * The log, collapsed to one line (v2 Phase 3b): the newest entry, and a button that
 * opens the whole thing.
 *
 * The log is still the record of what happened; it just stopped taking half the page.
 * The line is drawn by `LogLine`, the log's own renderer, cut to one line by CSS --
 * a roll keeps its heading and its outcome and drops its dice -- so the ticker and the
 * log cannot describe one entry two ways. What happened since your last decision, in
 * full, is 3c's roll panel; this is only the latest thing.
 */
export function LogTicker({
  state,
  human,
  open,
  onToggle,
}: {
  state: GameState
  human: PlayerId
  open: boolean
  onToggle: () => void
}) {
  const shown = state.log.filter(logShows)
  const latest = shown[shown.length - 1]
  return (
    <div className="log-ticker">
      <div className="log-ticker-line">
        {latest !== undefined && <LogLine entry={latest} state={state} human={human} />}
      </div>
      <button type="button" className="log-toggle" onClick={onToggle} aria-expanded={open}>
        {open ? 'Hide log' : `Log · ${shown.length}`}
      </button>
    </div>
  )
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
        .map((entry, i) => <LogLine key={i} entry={entry} state={state} human={human} />)
        .reverse()}
    </div>
  )
}
