/**
 * A terminal client, so the game can be played before any UI exists.
 *
 * This is the hedge against Phase 7 overrunning: the rules become playable, and
 * therefore judgeable, weeks before there is a board to look at. It is also the
 * fastest way to find rules bugs that tests did not think to ask about.
 *
 *   npm run play               -- you are p1, GreedyAI is p2
 *   npm run play -- --seed 42  -- a specific game
 *   npm run play -- --ai passive        -- an opponent that starts nothing
 *   npm run play -- --ai random         -- the fuzz opponent, for poking at rules
 *   npm run play -- --forces starter    -- the two hand-authored 30-health lists
 *   npm run play -- --forces bestiary   -- every monster and large die, so every SAI
 *   npm run play -- --forces mixed      -- rolled forces drawing from every species
 *   npm run play -- --forces built:data/forces/mixed-12.json   -- the exact forces in a file
 *   npm run play -- --p1-ai greedy      -- an AI plays your side too, and you watch
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { DEFAULT_OPPONENT, OPPONENT_NAMES, OPPONENTS, opponentNamed } from '../ai/opponents'
import { randomAi } from '../ai/random'
import type { AiPlayer } from '../ai/types'
import { SPECIES, dragonName, terrainDie, terrainDieName, terrainFaceAction, unitType } from '../data/load'
import { spell } from '../data/spells'
import type { Element, ResultType, TerrainFaceNumber } from '../data/types'
import { damageOptions } from '../engine/damage'
import { BREATH_NAME } from '../engine/dragons'
import { growthPartners, promotionGain } from '../engine/dua'
import { isAsleep } from '../engine/effects'
import { begin, reduce } from '../engine/reduce'
import { rngFrom, type RngState } from '../engine/rng'
import { mathPhrase, saiPhrase, type DieRoll, type RollMath } from '../engine/roll'
import { DRAGON_ROLL_KINDS, SAI_TEXT } from '../engine/sai'
import { rollOnTheTable } from '../engine/turn'
import { OWN_ARMY_NOTE, poolSplit, spellPlan, spellTargetLabel, stageCast, targetsFor } from '../engine/magic'


import { readBuiltForces } from '../engine/force'
import { FORCE_SETS, namedForces, setupGame, type ForceSpec } from '../engine/setup'
import {
  V1_RULES,
  TERRAIN_SLOTS,
  armyAt,
  army as armyRef,
  armyRefOf,
  buriedUnits,
  deadUnits,

  forceSize,
  forceSpecies,
  livingUnits,
  type AnnouncedSpell,
  type ArmyRef,
  type GameAction,
  type GameState,
  type LogEntry,
  type Pending,
  type PromotionPair,
  type PlayerId,
  type SpellTarget,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../engine/types'

// --- presentation ------------------------------------------------------------

const useColor = !process.env['NO_COLOR']
const paint = (code: string, text: string) => (useColor ? `[${code}m${text}[0m` : text)
const bold = (t: string) => paint('1', t)
const dim = (t: string) => paint('2', t)
const red = (t: string) => paint('31', t)
const green = (t: string) => paint('32', t)
const yellow = (t: string) => paint('33', t)
const cyan = (t: string) => paint('36', t)
const magenta = (t: string) => paint('35', t)

const SLOT_LABEL: Record<ArmyRef, string> = {
  p1_home: 'P1 home',
  frontier: 'Frontier',
  p2_home: 'P2 home',
  reserve: 'Reserves',
}

/** What earned a promotion, when it was not an SAI. */
const PROMOTION_SOURCE: Record<'city' | 'dragon_treasure' | 'dragon_slain', string> = {
  city: 'City',
  dragon_treasure: 'Treasure',
  dragon_slain: 'Dragon slain',
}

/** "melee" -> "Melee": the action reads as a name in a sentence, not a keyword. */
const actionName = (action: string) => action.charAt(0).toUpperCase() + action.slice(1)

const name = (unit: UnitInstance) => unitType(unit.typeId).name

/** The same, by id, for the entries that carry ids rather than units. */
const nameOf = (state: GameState, id: UnitId): string => {
  const unit = state.units[id]
  return unit === undefined ? id : name(unit)
}

const healthOf = (state: GameState, id: UnitId): number => {
  const unit = state.units[id]
  return unit === undefined ? 0 : unitType(unit.typeId).health
}

/** Destination keys for the free-move sheet, kept off the numbers the dice use. */
const letters = ['a', 'b', 'c', 'd']
/** "treefolk" -> "Treefolk": ids are the engine's vocabulary, not the player's. */
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id
/** A force as the list of species it holds (v2 Phase 1): "Treefolk", or
 *  "Firewalkers and Treefolk" for a mixed one. */
const speciesNames = (ids: readonly string[]) => ids.map(speciesName).join(' and ')
const health = (units: readonly UnitInstance[]) =>
  units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)

function armySummary(state: GameState, player: PlayerId, slot: TerrainSlot): string {
  const units = armyAt(state, player, slot)
  if (units.length === 0) return dim('    —    ')
  return `${units.length}d/${health(units)}h`.padEnd(9)
}

/** What is sitting on one army, in words: `Galeforce −4 save, −4 maneuver (until p1's
 *  next turn)`, or a die that cannot be rolled. */
function effectsOn(state: GameState, player: PlayerId, slot: TerrainSlot): readonly string[] {
  const out: string[] = []

  for (const effect of state.effects) {
    if (effect.target.kind !== 'army') continue
    if (effect.target.player !== player || effect.target.army !== slot) continue
    const what = effect.modifiers
      .map((m) =>
        m.kind === 'subtract'
          ? `−${m.amount} ${m.resultType}`
          : m.kind === 'add'
            ? `+${m.amount} ${m.resultType}`
            : m.kind === 'divide'
              ? `${m.resultType} ÷ ${m.by}`
              : m.kind === 'ignore_ids'
                ? `no ${m.resultType} from IDs`
                : m.kind === 'counts_as'
                  ? `${m.from} counts as ${m.resultType}`
                  : `${m.resultType} × ${m.by}`,
      )
      .join(', ')
    out.push(`${effect.source} ${what} ${dim(`(until ${effect.expiresAtStartOfTurnOf}'s turn)`)}`)
  }

  for (const unit of armyAt(state, player, slot)) {
    if (!isAsleep(state, unit.id)) continue
    out.push(`${name(unit)} is asleep — cannot be rolled or leave`)
  }

  return out
}

function board(state: GameState, human: PlayerId): string {
  const lines: string[] = []
  const turn = state.log.filter((e) => e.kind === 'turn_end').length + 1
  // The roll-off choice is open (v1 Phase 10e): nobody is marching, no face is rolled,
  // and the Frontier slot holds a placeholder. Printing it would show a board nobody rolled.
  const unrolled = state.rollOff !== undefined
  const who = unrolled
    ? cyan('roll-off')
    : state.turn.marching === human
      ? green('you march')
      : red('opponent marches')
  lines.push(bold(`\n── Turn ${turn} · ${who} ` + '─'.repeat(34)))

  for (const slot of TERRAIN_SLOTS) {
    const terrain = state.terrains[slot]
    if (unrolled) {
      // No face is rolled yet, so a Home shows what it can become -- its eighth face,
      // the one thing its draw decided -- and the undecided Frontier shows nothing.
      const frontier = slot === 'frontier'
      const name = frontier ? 'chosen after the roll-off' : terrain.dieId.replace('_', ' ')
      const eighth = frontier ? '' : `8 ▸ ${terrainDie(terrain.dieId).eighthFace.replace('_', ' ')}`
      lines.push(
        `  ${SLOT_LABEL[slot].padEnd(9)} ${dim(name.padEnd(26))}${cyan(eighth.padEnd(18))} ` +
          `P1 ${armySummary(state, 'p1', slot)} P2 ${armySummary(state, 'p2', slot)}`,
      )
      continue
    }
    const action =
      terrain.face === 8
        ? cyan(terrainDie(terrain.dieId).eighthFace.replace('_', ' '))
        : terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber).toLowerCase()
    const held = terrain.capturedBy ? cyan(` ★ held by ${terrain.capturedBy}`) : ''
    lines.push(
      `  ${SLOT_LABEL[slot].padEnd(9)} ${dim(terrain.dieId.replace('_', ' ').padEnd(18))}` +
        `${String(terrain.face)} ▸ ${action.padEnd(10)} ` +
        `P1 ${armySummary(state, 'p1', slot)} P2 ${armySummary(state, 'p2', slot)}${held}`,
    )

    // An effect with a duration is the only thing here that is true between rolls, so
    // it is printed under the terrain it sits on rather than left in a log line that
    // has already scrolled away.
    for (const player of ['p1', 'p2'] as const) {
      for (const effect of effectsOn(state, player, slot)) {
        lines.push(magenta(`              ${player} ${effect}`))
      }
    }
  }

  const reserve = (p: PlayerId) =>
    livingUnits(state, p).filter((u) => u.location.kind === 'reserve').length
  const buried = (p: PlayerId) => buriedUnits(state, p).length
  lines.push(
    dim(
      `  dead  P1 ${deadUnits(state, 'p1').length}  P2 ${deadUnits(state, 'p2').length}` +
        `   ·   reserve  P1 ${reserve('p1')}  P2 ${reserve('p2')}` +
        // Nothing buries until Phase 4, so this stays off the board until it does.
        (buried('p1') + buried('p2') > 0
          ? `   ·   buried  P1 ${buried('p1')}  P2 ${buried('p2')}`
          : ''),
    ),
  )

  return lines.join('\n')
}

/** Flaming Shields' share of a melee number, so the line says where it came from. */
const shields = (n: number | undefined): string =>
  n === undefined ? '' : dim(` (${n} of it saves counted as melee by ${bold('Flaming Shields')})`)

/**
 * A roll's arithmetic, named (Phase 9c), as the lines under the entry that carries it --
 * the same sentence the browser draws under a roll strip, from the same `mathPhrase`.
 */
function mathLines(entry: LogEntry): readonly string[] {
  const line = (label: string, math: RollMath | undefined, total: number | null): string[] => {
    if (math === undefined || total === null) return []
    const phrase = mathPhrase(math, total)
    const said = [phrase, ...math.notes].filter((s) => s !== '').join(' · ')
    return said === '' ? [] : [dim(`    ${label}: ${said}`)]
  }
  switch (entry.kind) {
    case 'combat_resolved':
      return [
        ...line(entry.action, entry.attackMath, entry.attackTotal),
        ...line('saves', entry.saveMath, entry.saveTotal),
      ]
    case 'maneuver_contested':
      return [
        ...line('marcher', entry.marcherMath, entry.marcher),
        ...line('defender', entry.defenderMath, entry.defender),
      ]
    case 'magic_rolled':
      return line('magic', entry.math, entry.total)
    case 'thorns':
      return line('melee', entry.math, entry.melee)
    case 'spell_saves':
      return line('saves', entry.math, entry.saves)
    case 'dragon_roll':
      return (['melee', 'missile', 'save'] as const).flatMap((kind) =>
        line(kind, entry.math?.[kind], entry.totals[kind]),
      )
    default:
      return []
  }
}

function describe(entry: LogEntry, state: GameState): string | null {
  switch (entry.kind) {
    case 'forces_drawn':
      return dim(
        `forces rolled: ${entry.health} health a side — ` +
          `p1 ${speciesNames(entry.species.p1)} (${entry.dice.p1} dice), ` +
          `p2 ${speciesNames(entry.species.p2)} (${entry.dice.p2} dice)`,
      )
    case 'order_of_play':
      return dim(`Horde roll-off ${entry.rolls.p1}–${entry.rolls.p2}: ${entry.firstPlayer} marches first`)
    // v1 Phase 10e: the roll-off decides who chooses, not who marches.
    case 'roll_off':
      return dim(
        `Horde roll-off ${entry.rolls.p1}–${entry.rolls.p2}: ${entry.winner} chooses the first turn or ` +
          `the Frontier — p1 proposes ${terrainDieName(entry.proposals.p1)}, ` +
          `p2 proposes ${terrainDieName(entry.proposals.p2)}`,
      )
    case 'roll_off_decided': {
      const loser = entry.winner === 'p1' ? 'p2' : 'p1'
      const frontier = `${bold(terrainDieName(entry.frontier))} (${entry.proposer}'s proposal)`
      return entry.took === 'first_turn'
        ? `${entry.winner} takes the first turn; ${loser} picks the Frontier: ${frontier}`
        : `${entry.winner} picks the Frontier: ${frontier}; ${entry.firstPlayer} marches first`
    }
    case 'march_begin':
      return `${entry.player} marches at ${SLOT_LABEL[entry.army as TerrainSlot] ?? entry.army}`
    case 'march_skipped':
      return dim(`${entry.player} skips a march`)
    case 'maneuver_declared':
      return `${entry.player} declares a maneuver at ${SLOT_LABEL[entry.slot]}`
    case 'maneuver_allowed':
      return dim('the maneuver is allowed')
    case 'maneuver_contested':
      return `contested: ${entry.marcher} vs ${entry.defender} maneuver — ${
        entry.marcherWins ? green('marcher wins') : red('marcher loses')
      }`
    case 'terrain_moved':
      return `${SLOT_LABEL[entry.slot]} moves ${entry.from} → ${bold(String(entry.to))}`
    case 'terrain_captured':
      return cyan(`${SLOT_LABEL[entry.slot]} captured by ${entry.by}!`)
    case 'terrain_lost':
      return yellow(`${entry.from} loses ${SLOT_LABEL[entry.slot]} (${entry.reason})`)
    // "action" rather than "attack" for magic: under `magic: 'spells'` it attacks
    // nothing, and under the v0 house rule it is still the magic action.
    case 'action_chosen':
      return `${entry.player} does a ${bold(actionName(entry.action))} ${
        entry.action === 'magic' ? 'action' : 'attack'
      } ${
        entry.fromSlot === entry.toSlot
          ? `at ${SLOT_LABEL[entry.fromSlot]}`
          : `from ${SLOT_LABEL[entry.fromSlot]} to ${SLOT_LABEL[entry.toSlot]}`
      }`
    case 'action_skipped':
      return dim(`${entry.player} takes no action`)
    case 'combat_resolved': {
      const kind = entry.isCounter ? 'counter-attack' : entry.action
      // Both ends when they differ -- a missile shot, or a counter coming back.
      const arrow =
        entry.attackerSlot === entry.defenderSlot
          ? `${kind} at ${SLOT_LABEL[entry.defenderSlot]}`
          : `${kind} ${SLOT_LABEL[entry.attackerSlot]} -> ${SLOT_LABEL[entry.defenderSlot]}`
      const base =
        entry.saveTotal === null
          ? `${entry.attackTotal} ${entry.action}${entry.action === 'magic' ? ' ÷ 2' : ''}`
          : `${entry.attackTotal} ${entry.action} − ${entry.saveTotal} saves`
      // The SAI is named, not just its arithmetic. Without the number the line does
      // not add up; without the name it adds up and explains nothing.
      const from = (kind: 'riposte' | 'unsavable') => {
        const names = saiPhrase([...entry.attackDice, ...(entry.saveDice ?? [])], kind)
        return names === null ? '' : ` from ${names}`
      }


      const sum =
        entry.unsavable === undefined
          ? base
          : `${base} + ${entry.unsavable} unsavable${from('unsavable')}`
      const back =
        entry.riposte === undefined
          ? ''
          : ` (${bold(String(entry.riposte))} straight back${from('riposte')}, no save)`
      return `  ${arrow}: ${sum} = ${bold(String(entry.damage))} damage${back}${shields(entry.flamingShields)}`

    }
    case 'units_killed':
      return red(
        `  ${entry.player} loses ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')}`,
      )
    case 'replanting': {
      const rolls = entry.dice
        .map((die) => `${shown(die)} ${entry.rooted.includes(die.unitId) ? green('takes root') : dim('no ID')}`)
        .join(', ')
      return `  ${bold('Replanting')} at ${SLOT_LABEL[entry.slot as TerrainSlot] ?? entry.slot}: ${rolls}`
    }
    case 'units_risen': {
      const rolls = (entry.dice ?? [])
        .map((die) => `${shown(die)} ${entry.unitIds.includes(die.unitId) ? green('rises') : dim('no Rise')}`)
        .join(', ')
      const rose = entry.unitIds.map((id) => (state.units[id] ? name(state.units[id]!) : id)).join(', ')
      return green(
        `  ${bold('Rise from the Ashes')}: ${rolls}` +
          (rose === '' ? '' : ` — ${rose} into ${entry.player}'s reserves`),
      )
    }
    // Before the kill it causes, so the line reads as cause and then effect.
    case 'sai_resolved':
      return yellow(
        `  ${bold(entry.sai)} targets ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')} at ${SLOT_LABEL[entry.slot]}`,
      )
    // The sub-roll a Smother, a Seize or a Bullseye puts its targets through. No dice
    // strip here -- the terminal log prints totals, not faces -- so the line says what
    // was asked for and who managed it.
    case 'sai_sub_roll': {
      const who = entry.escaped
        .map((id) => (state.units[id] ? name(state.units[id]!) : id))
        .join(', ')
      const one = entry.escaped.length === 1 ? 's' : ''
      const asked =
        entry.test === 'id' ? 'an ID icon' : entry.test === 'save' ? 'a save' : 'a maneuver'
      const got =
        entry.fate === 'bury'
          ? entry.escaped.length === 0
            ? 'none save, all buried'
            : `${who} save${one} and stay${one} in the DUA`
          : entry.escaped.length === 0
            ? 'none get away'
            : entry.toReserve === true
              ? `${who} escape${one} to ${entry.player}'s reserves`
              : `${who} get${one} away`
      const stake = entry.fate === 'bury' ? 'be buried' : 'die'
      return yellow(
        `  ${bold(entry.source)}: ${asked} or ${stake} — ${got}` +
          (entry.dice.length > 0 ? dim(`
    ${entry.dice.map(shown).join('  ')}`) : ''),
      )
    }
    // Says when it ends as well as what it hit: an effect with a duration is the one
    // thing in the log that is still true on the next line.
    case 'effect_cast': {
      const unit = entry.unitId === undefined ? undefined : state.units[entry.unitId]
      const what = entry.onDua === true
        ? `${entry.target}'s DUA`
        : unit
        ? name(unit)
        : entry.target === undefined
          ? (SLOT_LABEL[entry.slot as TerrainSlot] ?? String(entry.slot))
          : `${entry.target}'s army at ${SLOT_LABEL[entry.slot as TerrainSlot] ?? entry.slot}`
      // "settles on", not "catches": half the spells are cast on your own army.
      return cyan(
        `  ${bold(entry.source)} settles on ${what}` +
          dim(` — until the start of ${entry.player}'s next turn`),
      )
    }
    // Both halves of one decision: what the budget bought, and what it did not.
    case 'units_promoted': {
      const grown = entry.pairs
        .map((pair) => `${nameOf(state, pair.unitId)} -> ${nameOf(state, pair.partnerId)}`)
        .join(', ')
      const saves = entry.saveResults === undefined ? '' : `${entry.saveResults} save results`
      const why = entry.sai ?? PROMOTION_SOURCE[entry.source ?? 'city']
      return green(`  ${bold(why)}: ${[grown, saves].filter(Boolean).join(' and ') || 'nothing'}`)
    }

    case 'units_moved':
      return cyan(
        `  ${bold(entry.sai)} walks ${entry.unitIds.map((id) => nameOf(state, id)).join(', ')} ` +
          `from ${SLOT_LABEL[entry.from]} to ${SLOT_LABEL[entry.to]}`,
      )

    case 'units_buried':
      return red(
        `  ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')} ${entry.unitIds.length === 1 ? 'is' : 'are'} buried — no resurrection` +
          (entry.source === 'temple' ? ' (forced by the Temple)' : ''),
      )
    case 'units_recruited':
      return green(
        `  ${entry.player} recruits ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')} from the DUA to ${SLOT_LABEL[entry.slot]}`,
      )
    case 'effects_expired':
      return dim(`${entry.sources.join(', ')} wears off at the start of ${entry.player}'s turn`)

    case 'counter_declined':
      return dim(`${entry.player} declines to counter-attack`)

    // No dice strip: the terminal log prints totals, not faces.
    case 'magic_rolled':
      return (
        `  ${entry.player} rolls ${bold(String(entry.total))} magic at ` +
        `${SLOT_LABEL[entry.slot as TerrainSlot] ?? entry.slot} ` +
        dim(`(${poolSplit(entry.suppliers) ?? entry.elements.join(' or ')})`)
      )

    case 'spell_cast':
      return (
        `  ${entry.player} casts ` +
        `${spell(entry.spell).name}${entry.count > 1 ? ` x${entry.count}` : ''} ` +
        dim(`(${entry.element})`)
      )

    case 'units_resurrected':
      return green(
        `  ${entry.player} raises ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')} into the army at ${SLOT_LABEL[entry.slot as TerrainSlot] ?? entry.slot}`,
      )

    case 'dragon_summoned':
      return cyan(
        `  ${dragonName(entry.dieId)} is summoned to ${SLOT_LABEL[entry.slot]}` +
          dim(entry.from === 'pool' ? ' from the Summoning Pool' : ` from ${SLOT_LABEL[entry.from]}`),
      )

    case 'dispel_magic':
      return entry.spells.length === 0
        ? dim(`  ${nameOf(state, entry.unitId)} tries to dispel, and misses`)
        : cyan(
            `  ${bold('Dispel Magic')}: ${nameOf(state, entry.unitId)} stops ` +
              entry.spells.map((id) => spell(id).name).join(', '),
          )

    case 'cantrip':
      return cyan(
        `  ${bold('Cantrip')} gives ${entry.player} ${entry.points} magic` +
          dim(' — cantrip spells only'),
      )

    case 'flashfire':
      return cyan(
        `  ${bold('Flashfire')}: ${entry.unitIds.map((id) => nameOf(state, id)).join(', ')} ` +
          dim('thrown again'),
      )

    // Both faces, before and after (Phase 9d).
    case 'confused':
      return cyan(
        `  ${bold(entry.sai)}: ${entry.target}'s saves ${entry.before.map(shown).join('  ')} ` +
          `-> ${entry.after.map(shown).join('  ')}`,
      )

    case 'air_flight':
      return cyan(
        `  ${bold('Air Flight')}: ` +
          entry.moves
            .map((m) => `${nameOf(state, m.unitId)} ${SLOT_LABEL[m.from]} -> ${SLOT_LABEL[m.to]}`)
            .join(', '),
      )

    case 'rapid_growth':
      return cyan(
        `  ${bold('Rapid Growth')}: ${entry.unitIds.map((id) => nameOf(state, id)).join(', ')} ` +
          dim('thrown again'),
      )

    case 'units_regrown':
      return green(
        `  ${bold('Accelerated Growth')}: ` +
          entry.pairs
            .map((pair) => `${nameOf(state, pair.unitId)} -> ${nameOf(state, pair.partnerId)}`)
            .join(', '),
      )

    case 'flash_flood':
      return cyan(
        `  ${bold('Flash Flood')} at ${SLOT_LABEL[entry.slot]} — ` +
          (entry.moved ? 'the terrain goes down' : 'held') +
          dim(` (${entry.resisted} of ${entry.needed} maneuver)`),
      )

    case 'thorns':
      return yellow(
        `  ${bold('Wall of Thorns')} at ${SLOT_LABEL[entry.slot]}: ` +
          `${entry.melee} melee — ${bold(String(entry.damage))} damage` +
          shields(entry.flamingShields),
      )

    case 'spell_saves':
      return yellow(
        `  ${bold(entry.source)} at ${SLOT_LABEL[entry.slot]}: ` +
          `${entry.player} rolls ${bold(String(entry.saves))} saves`,
      )

    case 'spell_fizzled':
      return dim(`  ${spell(entry.spell).name} fizzles -- its target is gone`)

    case 'counter_suppressed':
      return yellow(`  ${entry.player} is taken by Surprise and cannot counter-attack`)

    case 'victory':
      return bold(green(`\n*** ${entry.player} wins by ${entry.reason} ***`))
    case 'reinforced': {
      // Named per destination, because one Reinforce Step can split a reserve across
      // terrains and the board only shows where they ended up.
      const groups = TERRAIN_SLOTS.map((slot) => ({
        slot,
        names: entry.moves
          .filter((move) => move.slot === slot)
          .map((move) => (state.units[move.unitId] ? name(state.units[move.unitId]!) : move.unitId)),
      })).filter((group) => group.names.length > 0)

      return dim(
        `${entry.player} reinforces ` +
          groups.map((g) => `${SLOT_LABEL[g.slot]} with ${g.names.join(', ')}`).join('; '),
      )
    }
    // No Frontier seed under `magic: 'spells'`: every dragon waits in the pool for a
    // `Summon Dragon`, which is what the base rules say and what Phase 6 could not do.
    case 'dragons_drawn': {
      const brings = `${entry.player} brings ${entry.pool.map(dragonName).join(' and ')}`
      return dim(
        entry.frontier === undefined
          ? `${brings} — both wait in the Summoning Pool`
          : `${brings} — ${dragonName(entry.frontier)} starts at the Frontier`,
      )
    }

    // One line per dragon: a flat list of faces never said who was attacked, hid
    // the rerolls inside one die, and never totalled anything.
    case 'dragon_attack':
      return [
        magenta(`dragon attack at ${SLOT_LABEL[entry.slot]} — ${entry.defender} is marching`),
        ...entry.dragons.map((dragon) => {
          const at =
            dragon.target.kind === 'army'
              ? `${entry.defender}'s army`
              : dragonName(dragon.target.dieId)
          const faces = dragon.faces.map(({ icon }) => icon.toLowerCase()).join(' → ')
          const damage = dragon.damage > 0 ? dim(` · ${dragon.damage} damage`) : ''
          return `  ${bold(dragonName(dragon.dieId))} → ${at}: ${faces}${damage}`
        }),
      ].join('\n')

    case 'dragon_breath':
      return red(
        `  ${bold(BREATH_NAME[entry.element])} kills ` +
          (entry.unitIds.map((id) => nameOf(state, id)).join(', ') || 'nothing'),
      )

    case 'dragon_breath_effect':
      return dim(
        `  ${BREATH_NAME[entry.element]} lingers on ${entry.player}'s army ` +
          `at ${SLOT_LABEL[entry.slot]}`,
      )

    case 'dragon_roll':
      return (
        `  ${entry.player} answers: ${bold(String(entry.totals.melee))} melee, ` +
        `${bold(String(entry.totals.missile))} missile, ${bold(String(entry.totals.save))} save` +
        shields(entry.flamingShields) +
        (entry.dice.length > 0 ? dim(`\n    ${entry.dice.map(shown).join('  ')}`) : '')
      )

    // The subtraction both ways (Phase 9c): what reached the army, and what the army
    // put on each dragon against the number that kills it.
    case 'dragon_damage': {
      const lines: string[] = []
      if (entry.incoming !== undefined) {
        lines.push(
          `  dragons deal ${entry.incoming.inflicted} − ${entry.incoming.saves} saves = ` +
            `${bold(String(entry.incoming.damage))} damage to ${entry.player} at ${SLOT_LABEL[entry.slot]}`,
        )
      }
      for (const a of entry.answered ?? []) {
        lines.push(
          `  ${a.melee} melee, ${a.missile} missile vs ${a.threshold} -> ` +
            `${dragonNameOf(state, a.dragonId)} ${a.slain ? bold('is slain') : 'survives'}`,
        )
      }
      for (const d of entry.duels ?? []) {
        lines.push(
          `  ${dragonNameOf(state, d.dragonId)} deals ${d.damage} vs ${d.threshold} -> ` +
            `${dragonNameOf(state, d.targetId)} ${d.slain ? bold('is slain') : 'survives'}`,
        )
      }
      return magenta(lines.join('\n'))
    }

    case 'dragon_home':
      return magenta(
        `  ${dragonName(entry.dieId)} ${entry.why === 'slain' ? 'is slain' : 'flies away'} ` +
          `and returns to its Summoning Pool`,
      )
    case 'turn_end':
    case 'game_start':
    case 'terrain_placed':
    case 'retreated':
      return null

  }
}

// --- prompting ---------------------------------------------------------------

interface Choice {
  readonly key: string
  readonly label: string
  readonly action: GameAction
}

const dragonNameOf = (state: GameState, dragonId: string | undefined): string => {
  const dragon = dragonId === undefined ? undefined : state.dragons[dragonId]
  return dragon === undefined ? 'a dragon' : dragonName(dragon.dieId)
}

function choicesFor(state: GameState, pending: Pending): Choice[] {
  switch (pending.kind) {
    case 'roll_off_choice':
      return [
        { key: '1', label: 'take the first turn (the enemy picks the Frontier)', action: { kind: 'roll_off_choice', take: 'first_turn' } },
        ...(['p1', 'p2'] as const).map((proposer, i) => ({
          key: String(i + 2),
          label: `pick the Frontier: ${terrainDieName(pending.proposals[proposer])} (${proposer === 'p1' ? 'your' : "the enemy's"} proposal; the enemy marches first)`,
          action: { kind: 'roll_off_choice', take: 'frontier', proposer } as GameAction,
        })),
      ]

    case 'choose_frontier':
      return (['p1', 'p2'] as const).map((proposer, i) => ({
        key: String(i + 1),
        label: `${terrainDieName(pending.proposals[proposer])} (${proposer === 'p1' ? 'your' : "the enemy's"} proposal)`,
        action: { kind: 'choose_frontier', proposer } as GameAction,
      }))

    case 'choose_march_army':
      return [
        ...pending.options.map((army, i) => ({
          key: String(i + 1),
          label: `march at ${SLOT_LABEL[army as TerrainSlot] ?? army}`,
          action: { kind: 'choose_march_army', army } as GameAction,
        })),
        { key: '0', label: 'skip this march', action: { kind: 'choose_march_army', army: null } },
      ]

    case 'choose_maneuver':
      return [
        { key: '1', label: 'declare a maneuver', action: { kind: 'choose_maneuver', maneuver: true } },
        { key: '0', label: 'do not maneuver', action: { kind: 'choose_maneuver', maneuver: false } },
      ]

    case 'contest_maneuver':
      return [
        { key: '1', label: 'contest it', action: { kind: 'contest_maneuver', contest: true } },
        { key: '0', label: 'allow it', action: { kind: 'contest_maneuver', contest: false } },
      ]

    case 'choose_direction':
      return pending.options.map((direction, i) => ({
        key: String(i + 1),
        label: `turn the terrain ${direction}`,
        action: { kind: 'choose_direction', direction } as GameAction,
      }))

    case 'choose_action':
      return [
        ...pending.legal.map((action, i) => ({
          key: String(i + 1),
          label: `take a ${action} action`,
          action: { kind: 'choose_action', action } as GameAction,
        })),
        { key: '0', label: 'take no action', action: { kind: 'choose_action', action: null } },
      ]

    case 'choose_missile_target':
      return pending.options.map((slot, i) => ({
        key: String(i + 1),
        label: `fire at ${SLOT_LABEL[slot]}`,
        action: { kind: 'choose_missile_target', slot } as GameAction,
      }))

    case 'choose_counter_attack':
      return [
        { key: '1', label: 'counter-attack', action: { kind: 'choose_counter_attack', counter: true } },
        { key: '0', label: 'do not counter', action: { kind: 'choose_counter_attack', counter: false } },
      ]

    case 'eighth_face_temple':
      return [
        { key: '1', label: 'force a burial', action: { kind: 'eighth_face_temple', force: true } },
        { key: '0', label: 'let it go', action: { kind: 'eighth_face_temple', force: false } },
      ]

    // One unit, one step, and declining is legal -- so a menu is the right shape.
    case 'dragon_treasure':
      return [
        ...pending.promotions.map((pair, i) => ({
          key: String(i + 1),
          label: `promote ${pair.unitId} -> ${pair.partnerId}`,
          action: { kind: 'dragon_treasure', pair } as GameAction,
        })),
        { key: '0', label: 'decline', action: { kind: 'dragon_treasure', pair: null } },
      ]

    case 'reinforce':
    case 'retreat':
    case 'assign_damage':
    case 'sai_target':
    case 'sai_target_army':
    // Their own sheets, like damage: a list of dice and a tally is not a menu.
    case 'sai_promote':
    case 'sai_move':
    case 'eighth_face_city':
      return []

    case 'dispel_magic':
      return [
        { key: '1', label: `roll ${nameOf(state, pending.unitId)}`, action: { kind: 'dispel_magic', roll: true } as GameAction },
        { key: '0', label: 'let it through', action: { kind: 'dispel_magic', roll: false } as GameAction },
      ]

    case 'dragon_order':
      return pending.options.map((slot, i) => ({
        key: String(i + 1),
        label: `dragons at ${SLOT_LABEL[slot]} attack next`,
        action: { kind: 'dragon_order', slot } as GameAction,
      }))

    case 'dragon_target': {
      const first = pending.choices[0]
      if (first === undefined) return []
      return first.options.map((dragonId, i) => ({
        key: String(i + 1),
        label: `${dragonNameOf(state, first.dragonId)} attacks ${dragonNameOf(state, dragonId)}`,
        action: {
          kind: 'dragon_target',
          targets: Object.fromEntries(
            pending.choices.map((c) => [
              c.dragonId,
              c.dragonId === first.dragonId ? dragonId : (c.options[0] as string),
            ]),
          ),
        } as GameAction,
      }))
    }

    case 'spell_move':
      return pending.options.map((slot, i) => ({
        key: String(i + 1),
        label: `move to ${SLOT_LABEL[slot]}`,
        action: { kind: 'spell_move', slot } as GameAction,
      }))

    case 'spell_summon':
      return pending.options.map((dragonId, i) => ({
        key: String(i + 1),
        label: `summon ${dragonNameOf(state, dragonId)} to ${SLOT_LABEL[pending.slot]}`,
        action: { kind: 'spell_summon', dragonId } as GameAction,
      }))

    case 'flashfire':
    case 'rapid_growth':
    case 'accelerated_growth':
    case 'announce_spells':
    case 'temple_bury':
    case 'dragon_breath':
    case 'dragon_allocate':
    case 'dragon_damage_split':
      return [] // handled separately
  }
}

/**
 * The spell picker, one spell at a time.
 *
 * Staged rather than dispatched per spell, exactly as the Reinforce Step is: the rules
 * announce every spell at once and pick the resolution order afterwards, so asking
 * spell by spell and resolving as you go would answer a question nobody was asked.
 * Enter with nothing staged casts nothing, which is always legal.
 */
async function askSpells(
  state: GameState,
  pending: Extract<Pending, { kind: 'announce_spells' }>,
): Promise<GameAction> {
  let casts: readonly AnnouncedSpell[] = []

  for (;;) {
    const plan = spellPlan(pending.castable, pending.pool, casts)
    const affordable = plan.offers.filter((o) => o.affordable >= 1)

    console.log(`
${bold('Magic')} ${dim(`— ${plan.remaining} of ${pending.pool.points} left`)}`)
    if (casts.length > 0) {
      console.log(
        dim(
          '  staged: ' +
            casts
              .map(
                (c) =>
                  `${spell(c.spell).name}${c.count > 1 ? ` x${c.count}` : ''} -> ` +
                  spellName(state, c.target),
              )
              .join(', '),
        ),
      )
    }

    affordable.forEach((offer, i) => {
      const s = offer.castable.spell
      console.log(`  ${i + 1}) ${s.name} ${dim(`(${s.cost} ${offer.castable.elements.join('/')})`)}`)
      console.log(dim(`     ${s.text}`))
      if (s.target === 'own_army') console.log(dim(`     ${OWN_ARMY_NOTE}`))
    })
    console.log(`  0) ${casts.length > 0 ? `cast ${casts.length}` : 'cast nothing'}`)

    const reply = (await ask('> ')).trim()
    if (reply === '0' || reply === '') return { kind: 'announce_spells', casts }

    const offer = affordable[Number(reply) - 1]
    if (offer === undefined) {
      console.log(red('  pick one of the listed spells, or 0 to finish'))
      continue
    }

    // An Elemental spell takes any one of the caster's elements, and which one paid is
    // what Resurrect Dead and Summon Dragon both read. One element means no question.
    let element = offer.castable.elements[0] as Element
    if (offer.castable.elements.length > 1) {
      console.log(dim(`  pay for ${offer.castable.spell.name} with which element?`))
      offer.castable.elements.forEach((e, i) => console.log(`    ${i + 1}) ${e}`))
      const picked = offer.castable.elements[Number((await ask('> ')).trim()) - 1]
      if (picked === undefined) {
        console.log(red('  no element chosen; nothing staged'))
        continue
      }
      element = picked
    }

    // Only what this element can reach: a mixed DUA's Firewalker is not raised by water.
    const targets = targetsFor(offer.castable, element)
    console.log(dim(`  aim ${offer.castable.spell.name} where?`))
    targets.forEach((aim, i) => {
      const price = aim.minCount > 1 ? dim(` (${aim.minCount} castings)`) : ''
      console.log(`    ${i + 1}) ${spellName(state, aim.target)}${price}`)
    })
    const aimed = targets[Number((await ask('> ')).trim()) - 1]
    if (aimed === undefined) {
      console.log(red('  no target chosen; nothing staged'))
      continue
    }
    const which = aimed.target

    // Two castings of one spell at one target are one combined spell with its number
    // multiplied, not two spells -- so this merges rather than appending, and a second
    // casting of a non-cumulative spell there is refused rather than staged.
    const cast = { spell: offer.castable.spell.id, element, count: aimed.minCount, target: which }
    const next = stageCast(pending.castable, casts, cast)
    if (next === casts) {
      console.log(red(`  ${offer.castable.spell.name} is already aimed there; a second casting buys nothing`))
      continue
    }
    casts = [...next]
  }
}

/** Flashfire: which of your own dice to throw again, or none. */
async function askFlashfire(
  state: GameState,
  pending: Extract<Pending, { kind: 'flashfire' }>,
): Promise<GameAction> {
  const units = pending.options
    .map((id) => state.units[id])
    .filter((u): u is UnitInstance => u !== undefined)

  console.log(
    `\n${bold('Flashfire')} ${dim(
      `— up to ${pending.budget}, space-separated numbers, or enter to keep them`,
    )}`,
  )
  units.forEach((unit, i) => console.log(`  ${i + 1}) ${name(unit)}`))

  const picked = pick(units, (await ask('> ')).trim()).slice(0, pending.budget)
  return { kind: 'flashfire', unitIds: picked.map((u) => u.id) }
}

/** Rapid Growth: which dice that did not roll an SAI to throw again, all together. */
async function askRapidGrowth(
  state: GameState,
  pending: Extract<Pending, { kind: 'rapid_growth' }>,
): Promise<GameAction> {
  const units = pending.options
    .map((id) => state.units[id])
    .filter((u): u is UnitInstance => u !== undefined)
  const roll = rollOnTheTable(state)

  console.log(
    `\n${bold('Rapid Growth')} ${dim(
      `— they maneuvered ${pending.marcher}, you ${pending.defender}. ` +
        'Space-separated numbers to throw again together, or enter to keep the roll',
    )}`,
  )
  units.forEach((unit, i) => {
    const die = roll?.dice.find((d) => d.unitId === unit.id)
    console.log(`  ${i + 1}) ${name(unit)}${die === undefined ? '' : dim(` — ${shown(die)}`)}`)
  })

  const picked = pick(units, (await ask('> ')).trim())
  return { kind: 'rapid_growth', unitIds: picked.map((u) => u.id) }
}

/**
 * Accelerated Growth: one question per dying die, in turn -- which small one comes up
 * in its place, or enter to let it die. A partner once taken is not offered again.
 */
async function askAcceleratedGrowth(
  state: GameState,
  pending: Extract<Pending, { kind: 'accelerated_growth' }>,
): Promise<GameAction> {
  console.log(
    `
${bold('Accelerated Growth')} ${dim('— a dying die may swap with a one-health die from your DUA')}`,
  )
  const pairs: PromotionPair[] = []
  for (const unitId of pending.dying) {
    const left = pending.partners.filter((id) => !pairs.some((p) => p.partnerId === id))
    if (left.length === 0) break
    console.log(`  ${nameOf(state, unitId)} is dying. Exchange it with:`)
    left.forEach((id, i) => console.log(`    ${i + 1}) ${nameOf(state, id)}`))
    const partnerId = left[Number((await ask('> (enter to let it die) ')).trim()) - 1]
    if (partnerId !== undefined) pairs.push({ unitId, partnerId })
  }
  return { kind: 'accelerated_growth', pairs }
}

/** A spell target in the terminal's own vocabulary. The join lives in `magic.ts`, so
 *  the browser and the terminal cannot start describing one target two ways. */
const spellName = (state: GameState, target: SpellTarget): string =>
  spellTargetLabel(
    target,
    state.turn.marching,
    (ref) => SLOT_LABEL[ref as TerrainSlot] ?? 'reserve',
    (id) => (state.units[id] ? name(state.units[id]!) : id),
    (id) => armyRefOf(state, id),
  )

const rl = createInterface({ input: stdin, output: stdout })

/**
 * Buffered line input.
 *
 * `rl.question()` only captures lines emitted *after* it is called. That is fine
 * when a human types, but piped input arrives all at once, so every line after the
 * first is dropped and the game exits mid-turn. Queueing the lines ourselves makes
 * the client scriptable -- which is how it gets tested, and how a session can be
 * replayed from a file.
 */
const queued: string[] = []
const waiting: ((line: string) => void)[] = []
let inputClosed = false

rl.on('line', (line) => {
  const next = waiting.shift()
  if (next) next(line)
  else queued.push(line)
})
rl.on('close', () => {
  inputClosed = true
  // Anything still waiting gets a quit rather than hanging forever.
  for (const next of waiting.splice(0)) next('q')
})

function ask(prompt: string): Promise<string> {
  stdout.write(prompt)
  const line = queued.shift()
  if (line !== undefined) return Promise.resolve(line)
  if (inputClosed) return Promise.resolve('q')
  return new Promise((resolve) => waiting.push(resolve))
}

/** The damage sheet: toggle units until the selection absorbs everything it can. */
/**
 * Pick a maximal subset of an army by health: the damage sheet, and the targeting
 * sheet, which are the same question asked by two rules.
 *
 * Shared rather than copied because the confirm gate is the fiddly part -- "as much as
 * possible, no more than needed" -- and two copies of it would drift into a terminal
 * that accepts an assignment the engine then refuses.
 */
async function askBudget(
  state: GameState,
  kind: 'assign_damage' | 'sai_target',
  army: readonly UnitInstance[],
  budget: number,
  title: string,
  nothingToTake: string,
): Promise<GameAction> {
  const { required, suggestion } = damageOptions(army, budget)

  if (required === 0) {
    console.log(dim(`  ${nothingToTake}`))
    return { kind, unitIds: [] }
  }

  const chosen = new Set<string>()
  for (;;) {
    const absorbed = [...chosen].reduce((sum, id) => sum + unitType(state.units[id]!.typeId).health, 0)
    console.log(
      `\n${bold(title)} — ${bold(String(required))} health ` +
        dim('(as much as possible, no more than needed)'),
    )
    army.forEach((unit, i) => {
      const mark = chosen.has(unit.id) ? red('✗') : ' '
      console.log(`  ${mark} ${i + 1}) ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h)`)}`)
    })
    console.log(
      `  absorbed ${absorbed} / ${required}` +
        (absorbed === required ? green('  — press enter to confirm') : '') +
        dim('   ·  a = auto, c = clear'),
    )

    const reply = (await ask('> ')).trim().toLowerCase()
    if (reply === 'a') return { kind, unitIds: suggestion }
    if (reply === 'c') {
      chosen.clear()
      continue
    }
    if (reply === '' && absorbed === required) {
      return { kind, unitIds: [...chosen] }
    }
    for (const token of reply.split(/\s+/).filter(Boolean)) {
      const unit = army[Number(token) - 1]
      if (unit === undefined) {
        console.log(red(`  no unit ${token}`))
        continue
      }
      if (chosen.has(unit.id)) chosen.delete(unit.id)
      else chosen.add(unit.id)
    }
  }
}

async function askDamage(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'assign_damage') throw new Error('not damage')
  return askBudget(
    state,
    'assign_damage',
    armyRef(state, pending.player, pending.slot),
    pending.damage,
    `Assign ${pending.damage} damage — you must lose`,
    `${pending.damage} damage cannot kill anything — no die has few enough health`,
  )
}

/** A breath picks from your own army, maximally -- the damage sheet again. */
async function askDragonBreath(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'dragon_breath') throw new Error('not a breath')
  const dragon = state.dragons[pending.dragonId]
  const name = dragon === undefined ? 'A dragon' : dragonName(dragon.dieId)
  const action = await askBudget(
    state,
    'assign_damage',
    armyRef(state, pending.player, pending.slot),
    pending.health,
    `${name} breathes — ${pending.health} health-worth of your army dies; you must lose`,
    `${pending.health} health-worth cannot be taken from this army`,
  )
  return { kind: 'dragon_breath', unitIds: action.kind === 'assign_damage' ? action.unitIds : [] }
}

/** Splitting the combination roll: how many of each go to melee, missile and save. */
async function askDragonAllocate(pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'dragon_allocate') throw new Error('not a dragon allocation')

  const split = async (total: number, what: string) => {
    const out: Partial<Record<ResultType, number>> = {}
    let left = total
    for (const kind of DRAGON_ROLL_KINDS) {
      if (left === 0) break
      const last = DRAGON_ROLL_KINDS[DRAGON_ROLL_KINDS.length - 1]
      if (kind === last) {
        out[kind] = left
        break
      }
      console.log(dim(`  ${left} ${what} left — how many as ${kind}?`))
      const n = Math.max(0, Math.min(left, Number((await ask('> ')).trim()) || 0))
      if (n > 0) out[kind] = n
      left -= n
    }
    return out
  }

  console.log()
  console.log(bold('  Your dragon roll counts melee, missile and save at once.'))
  const ids = await split(pending.ids, 'ID results')
  const flexible = await split(pending.flexible, 'Create Fireminions results')
  const shields = pending.shields ?? 0
  if (shields === 0) return { kind: 'dragon_allocate', ids, flexible }

  // Flaming Shields: a trade here, saves against the dragon for melee against its hide.
  console.log(dim(`  ${bold('Flaming Shields')}: count how many of ${shields} saves as melee?`))
  const savesAsMelee = Math.max(0, Math.min(shields, Number((await ask('> ')).trim()) || 0))
  return { kind: 'dragon_allocate', ids, flexible, ...(savesAsMelee > 0 ? { savesAsMelee } : {}) }
}

/** Which dragons the melee and missile go to. Ten kills one, or five past a belly. */
async function askDragonDamageSplit(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'dragon_damage_split') throw new Error('not a damage split')

  const melee: Record<string, number> = {}
  const missile: Record<string, number> = {}
  let meleeLeft = pending.melee
  let missileLeft = pending.missile

  console.log()
  console.log(bold('  Spend your results on the dragons. One type each — they never combine.'))
  for (const target of pending.targets) {
    const dragon = state.dragons[target.dragonId]
    const name = dragon === undefined ? target.dragonId : dragonName(dragon.dieId)
    console.log(dim(`  ${name} needs ${target.threshold} of one type to die`))
    if (meleeLeft > 0) {
      console.log(dim(`    ${meleeLeft} melee left — how many at it?`))
      const n = Math.max(0, Math.min(meleeLeft, Number((await ask('> ')).trim()) || 0))
      melee[target.dragonId] = n
      meleeLeft -= n
    }
    if (missileLeft > 0) {
      console.log(dim(`    ${missileLeft} missile left — how many at it?`))
      const n = Math.max(0, Math.min(missileLeft, Number((await ask('> ')).trim()) || 0))
      missile[target.dragonId] = n
      missileLeft -= n
    }
  }
  return { kind: 'dragon_damage_split', melee, missile }
}

/**
 * What every SAI prompt opens with: the dice that produced it, then the rule.
 *
 * **Roll, then SAIs, then the totals** -- the order the rules resolve in, which is not
 * the order either client used to show: the dice reached the log only when the whole
 * exchange was over, long after the decision they caused had been answered.
 *
 * The rule comes with them because "target 4 health-worth" is the part a player can
 * already see, and what happens to the dice afterwards is the part it hides.
 */
/** One rolled die as `Genie 4 Firewalking` or `Oak 4 save (4)`. */
function shown(die: DieRoll): string {
  const face = die.face
  const what = face.icon === 'SAI' ? `${face.count} ${face.sai}` : `${face.count} ${face.icon.toLowerCase()}`
  return `${unitType(die.typeId).name} ${what}${die.results > 0 ? ` (${die.results})` : ''}`
}

function saiHeader(state: GameState, sai: string): void {
  const roll = rollOnTheTable(state)
  if (roll !== null && roll.dice.length > 0) {
    console.log(dim(`  ${roll.kind === 'save' ? 'saves' : 'the roll'}: ${roll.dice.map(shown).join('  ')}`))
  }

  const text = SAI_TEXT[sai]
  if (text !== undefined) console.log(dim(`  ${text}`))
}

async function askSaiTarget(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'sai_target') throw new Error('not an SAI target')
  // Choke may only take the dice that rolled an ID icon, so those are the only ones
  // offered -- and the maximum it is held to is the maximum within them.
  const army = armyRef(state, pending.target, pending.slot).filter(
    (unit) => pending.eligible === undefined || pending.eligible.includes(unit.id),
  )
  const more = pending.remaining > 1 ? dim(` (${pending.remaining} still to place)`) : ''

  // One die, not health-worth: a separate loop, because there is no budget to tally
  // and "absorbed 4 / must reach 4" would be a lie about what is being asked.
  if (pending.limit.kind === 'one') {
    for (;;) {
      console.log(`\n${bold(`${pending.sai} — put one die to sleep`)}${more}`)
      saiHeader(state, pending.sai)
      army.forEach((unit, i) => {
        console.log(`    ${i + 1}) ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h)`)}`)
      })
      const reply = (await ask('> ')).trim()
      const unit = army[Number(reply) - 1]
      if (unit !== undefined) return { kind: 'sai_target', unitIds: [unit.id] }
      console.log(red('  pick one of the listed dice'))
    }
  }

  saiHeader(state, pending.sai)
  return askBudget(
    state,
    'sai_target',
    army,
    pending.limit.budget,
    `${pending.sai} — target${more}`,
    `${pending.sai} can take ${pending.limit.budget} health-worth, and no die there is that small`,
  )
}

/**
 * Wild Growth: pairs, not a budget of dice.
 *
 * Two lists, because a promotion is two dice -- one in the army going down to the DUA
 * and one in the DUA coming up -- and the player picks both ends. Anything left over
 * is save results, which is why "done" is always a legal answer and the sheet says
 * what it will buy.
 */
async function askSaiPromote(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'sai_promote') throw new Error('not a promotion')
  const pairs: { unitId: UnitId; partnerId: UnitId }[] = []

  for (;;) {
    const spent = pairs.reduce((sum, pair) => sum + promotionGain(state, pair), 0)
    const left = pending.budget - spent
    const army = armyRef(state, pending.player, pending.slot).filter(
      (unit) => !pairs.some((pair) => pair.unitId === unit.id),
    )
    const promotable = army.filter((unit) => growthPartners(state, unit.id, left).length > 0)

    saiHeader(state, pending.sai)
    console.log(
      `\n${bold(`${pending.sai} — ${left} health of promotion left`)}` +
        dim(`, and ${left} save results if you stop here`),
    )
    for (const pair of pairs) {
      console.log(dim(`    ${nameOf(state, pair.unitId)} -> ${nameOf(state, pair.partnerId)}`))
    }
    if (promotable.length === 0) {
      console.log(dim('    nothing else can be promoted'))
      return { kind: 'sai_promote', pairs }
    }
    promotable.forEach((unit, i) => {
      console.log(`    ${i + 1}) promote ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h)`)}`)
    })
    console.log('    0) done')

    const reply = (await ask('> ')).trim()
    if (reply === '0' || reply === '') return { kind: 'sai_promote', pairs }

    const unit = promotable[Number(reply) - 1]
    if (unit === undefined) {
      console.log(red('  pick one of the listed dice'))
      continue
    }

    const options = growthPartners(state, unit.id, left).filter(
      (dead) => !pairs.some((pair) => pair.partnerId === dead.id),
    )
    if (options.length === 0) {
      console.log(red('  nothing in your DUA it can grow into for that'))
      continue
    }

    console.log(`  ${bold(`${name(unit)} becomes`)}`)
    options.forEach((dead, i) => {
      const cost = unitType(dead.typeId).health - unitType(unit.typeId).health
      console.log(`    ${i + 1}) ${name(dead)} ${dim(`(costs ${cost})`)}`)
    })
    const partner = options[Number((await ask('  > ')).trim()) - 1]
    if (partner === undefined) {
      console.log(red('  not one of those'))
      continue
    }
    pairs.push({ unitId: unit.id, partnerId: partner.id })
  }
}

/** Firewalking and Teleport: a destination, and whoever is coming along. */
async function askSaiMove(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'sai_move') throw new Error('not a free move')
  const others = armyRef(state, pending.player, pending.slot).filter(
    (unit) => unit.id !== pending.unitId && !isAsleep(state, unit.id),
  )
  const chosen = new Set<UnitId>()

  for (;;) {
    const carried = [...chosen].reduce((sum, id) => sum + healthOf(state, id), 0)
    saiHeader(state, pending.sai)
    console.log(
      `\n${bold(`${pending.sai} — ${nameOf(state, pending.unitId)} may walk off`)}` +
        dim(` carrying up to ${pending.health} health-worth (${carried} chosen)`),
    )
    others.forEach((unit, i) => {
      const mark = chosen.has(unit.id) ? '*' : ' '
      console.log(`   ${mark}${i + 1}) ${name(unit)} ${dim(`(${healthOf(state, unit.id)}h)`)}`)
    })
    pending.options.forEach((slot, i) => {
      console.log(`    ${letters[i]}) go to ${SLOT_LABEL[slot]}`)
    })
    console.log('    0) stay put')

    const reply = (await ask('> ')).trim()
    if (reply === '0' || reply === '') return { kind: 'sai_move', slot: null, unitIds: [] }

    const slot = pending.options[letters.indexOf(reply)]
    if (slot !== undefined) {
      if (carried > pending.health) {
        console.log(red(`  that is ${carried} health-worth, and it can carry ${pending.health}`))
        continue
      }
      return { kind: 'sai_move', slot, unitIds: [...chosen] }
    }

    const unit = others[Number(reply) - 1]
    if (unit === undefined) {
      console.log(red('  pick a die, a destination, or 0'))
      continue
    }
    if (chosen.has(unit.id)) chosen.delete(unit.id)
    else chosen.add(unit.id)
  }
}

/**
 * City: one unit, either recruited or promoted -- or neither, since "may" both ways.
 * Same shape as Wild Growth's promotion sheet, minus the budget: a City promotion is
 * the ordinary one-step rule, not health-worth.
 */
async function askEighthFaceCity(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'eighth_face_city') throw new Error('not the City')

  console.log(`\n${bold('City')} — recruit or promote one unit, or do nothing`)
  const options: { label: string; action: GameAction }[] = []

  for (const partnerId of pending.recruits) {
    options.push({
      label: `recruit ${nameOf(state, partnerId)} to ${SLOT_LABEL[pending.slot]}`,
      action: { kind: 'eighth_face_city', choice: { kind: 'recruit', unitId: partnerId } },
    })
  }
  for (const pair of pending.promotions) {
    options.push({
      label: `promote ${nameOf(state, pair.unitId)} -> ${nameOf(state, pair.partnerId)}`,
      action: { kind: 'eighth_face_city', choice: { kind: 'promote', pair } },
    })
  }

  options.forEach((option, i) => console.log(`    ${i + 1}) ${option.label}`))
  console.log('    0) do nothing')

  const reply = (await ask('> ')).trim()
  if (reply === '0' || reply === '') return { kind: 'eighth_face_city', choice: null }
  const chosen = options[Number(reply) - 1]
  return chosen === undefined
    ? { kind: 'eighth_face_city', choice: null }
    : chosen.action
}

/** Temple's second decision: the opponent picks which of their own DUA units is
 *  buried. Never offered with nothing to pick from -- see `eighthFacePending`. */
async function askTempleBury(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'temple_bury') throw new Error('nobody is being forced to bury a unit')

  for (;;) {
    console.log(`\n${bold('Temple')} — ${pending.player} must bury one unit`)
    pending.options.forEach((id, i) => console.log(`    ${i + 1}) ${nameOf(state, id)}`))
    const reply = (await ask('> ')).trim()
    const unitId = pending.options[Number(reply) - 1]
    if (unitId !== undefined) return { kind: 'temple_bury', unitId }
    console.log(red('  pick one of the listed dice'))
  }
}

async function askSaiTargetArmy(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'sai_target_army') throw new Error('not an SAI army target')
  const enemy = pending.player === 'p1' ? 'p2' : 'p1'

  for (;;) {
    console.log(
      `\n${bold(`${pending.sai} — target an opposing army`)}` +
        (pending.remaining > 1 ? dim(` (${pending.remaining} still to place)`) : ''),
    )
    pending.options.forEach((slot, i) => {
      const units = armyAt(state, enemy, slot)
      console.log(`    ${i + 1}) ${SLOT_LABEL[slot]} ${dim(`(${units.length}d/${health(units)}h)`)}`)
    })
    const reply = (await ask('> ')).trim()
    const slot = pending.options[Number(reply) - 1]
    if (slot !== undefined) return { kind: 'sai_target_army', slot }
    console.log(red('  pick one of the listed terrains'))
  }
}

async function askUnits(state: GameState, pending: Pending): Promise<GameAction> {
  const player = pending.player
  if (pending.kind === 'reinforce') return askReinforce(state, player)

  const movable = livingUnits(state, player).filter((u) => u.location.kind === 'terrain')

  const canFly = pending.kind === 'retreat' && (pending.flights ?? []).length > 0
  console.log(
    `\n${bold('Retreat')} ${dim(
      '— space-separated numbers to pull back to reserve, or enter for none' +
        (canFly ? '; Air Flight is asked next, for the dice that stay' : ''),
    )}`,
  )
  movable.forEach((unit, i) => {
    const where = unit.location.kind === 'terrain' ? SLOT_LABEL[unit.location.slot] : 'reserve'
    console.log(`  ${i + 1}) ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h, ${where})`)}`)
  })

  const picked = pick(movable, (await ask('> ')).trim())
  const unitIds = picked.map((u) => u.id)

  // Air Flight: offered per die, after the retreats, for the dice that stayed.
  const offers = (pending.kind === 'retreat' ? (pending.flights ?? []) : []).filter(
    (offer) => !unitIds.includes(offer.unitId),
  )
  const flights: { unitId: string; slot: TerrainSlot }[] = []
  if (offers.length > 0) {
    console.log(`\n${bold('Air Flight')} ${dim('— for each die: a destination number, or enter to stay')}`)
    for (const offer of offers) {
      const unit = state.units[offer.unitId]
      if (unit === undefined) continue
      const from = unit.location.kind === 'terrain' ? SLOT_LABEL[unit.location.slot] : 'reserve'
      const choices = offer.options.map((slot, i) => `${i + 1}) ${SLOT_LABEL[slot]}`).join('  ')
      console.log(`  ${name(unit)} ${dim(`(at ${from})`)}  ${choices}`)
      const slot = offer.options[Number((await ask('> ')).trim()) - 1]
      if (slot !== undefined) flights.push({ unitId: offer.unitId, slot })
    }
  }
  return { kind: 'retreat', unitIds, ...(flights.length > 0 ? { flights } : {}) }
}

const pick = (from: readonly UnitInstance[], reply: string): readonly UnitInstance[] =>
  reply
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => from[Number(t) - 1])
    .filter((u): u is UnitInstance => u !== undefined)

/**
 * The Reinforce Step, one destination at a time.
 *
 * "You may move any or all of them to any terrains. You may split the reserve units
 * up, sending some to one terrain and some to another." So this loops: pick some
 * dice, name a terrain, repeat, then send. It used to ask once and send everything
 * to a single slot, which is half the step -- and the half that matters when two
 * fronts both need a die.
 */
async function askReinforce(state: GameState, player: PlayerId): Promise<GameAction> {
  const reserve = livingUnits(state, player).filter((u) => u.location.kind === 'reserve')
  const moves: { unitId: string; slot: TerrainSlot }[] = []

  for (;;) {
    const assigned = new Set(moves.map((m) => m.unitId))
    const left = reserve.filter((u) => !assigned.has(u.id))

    console.log(
      `\n${bold('Reinforce')} ${dim('— space-separated numbers, then a terrain. Enter to send.')}`,
    )
    left.forEach((unit, i) => {
      console.log(`  ${i + 1}) ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h)`)}`)
    })
    for (const slot of TERRAIN_SLOTS) {
      const going = moves.filter((m) => m.slot === slot)
      if (going.length === 0) continue
      const names = going.map((m) => name(state.units[m.unitId]!)).join(', ')
      console.log(dim(`  -> ${SLOT_LABEL[slot]}: ${names}`))
    }
    if (left.length === 0 && moves.length === 0) return { kind: 'reinforce', moves: [] }

    const picked = pick(left, (await ask('> ')).trim())
    if (picked.length === 0) return { kind: 'reinforce', moves }

    console.log(dim('  send them to which terrain?'))
    TERRAIN_SLOTS.forEach((slot, i) => console.log(`  ${i + 1}) ${SLOT_LABEL[slot]}`))
    const slot = TERRAIN_SLOTS[Number((await ask('> ')).trim()) - 1] ?? 'frontier'
    for (const unit of picked) moves.push({ unitId: unit.id, slot })
  }
}

async function askHuman(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind === 'assign_damage') return askDamage(state, pending)
  if (pending.kind === 'dragon_breath') return askDragonBreath(state, pending)
  if (pending.kind === 'dragon_allocate') return askDragonAllocate(pending)
  if (pending.kind === 'dragon_damage_split') return askDragonDamageSplit(state, pending)
  if (pending.kind === 'sai_target') return askSaiTarget(state, pending)
  if (pending.kind === 'sai_target_army') return askSaiTargetArmy(state, pending)
  if (pending.kind === 'sai_promote') return askSaiPromote(state, pending)
  if (pending.kind === 'sai_move') return askSaiMove(state, pending)
  if (pending.kind === 'reinforce' || pending.kind === 'retreat') return askUnits(state, pending)
  if (pending.kind === 'eighth_face_city') return askEighthFaceCity(state, pending)
  if (pending.kind === 'temple_bury') return askTempleBury(state, pending)
  if (pending.kind === 'announce_spells') return askSpells(state, pending)
  if (pending.kind === 'flashfire') return askFlashfire(state, pending)
  if (pending.kind === 'rapid_growth') return askRapidGrowth(state, pending)
  if (pending.kind === 'accelerated_growth') return askAcceleratedGrowth(state, pending)

  const choices = choicesFor(state, pending)
  for (;;) {
    console.log()
    for (const choice of choices) console.log(`  ${choice.key}) ${choice.label}`)
    const reply = (await ask('> ')).trim().toLowerCase()
    if (reply === 'q') {
      console.log(dim('\nbye'))
      process.exit(0)
    }
    const found = choices.find((c) => c.key === reply)
    if (found) return found.action
    console.log(red('  pick one of the listed options, or q to quit'))
  }
}

// --- main --------------------------------------------------------------------

/** `--forces <name>`, or rolled from the seed when it is absent. An unknown name is
 *  answered with the list rather than a silent fallback to random. `mixed` rolls forces
 *  from every species at once, and `built:<file>` reads the exact forces from JSON
 *  (v2 Phase 2; `data/forces/` holds examples). */
function forcesArg(name: string | undefined): ForceSpec {
  if (name === undefined) return { kind: 'random' }
  if (name === 'mixed') return { kind: 'random', mixed: true }
  if (name.startsWith('built:')) return builtArg(name.slice('built:'.length))
  const found = namedForces(name)
  if (found === null) {
    console.error(
      `unknown --forces ${name}; try ${[...Object.keys(FORCE_SETS), 'mixed', 'built:<file>'].join(', ')}, ` +
        'or omit it to roll them',
    )
    process.exit(1)
  }
  return found
}

/** A built-force file: read, parsed and shape-checked here, so a typo is a sentence
 *  rather than a stack trace. Whether the forces are legal, `setupGame` says. */
function builtArg(path: string): ForceSpec {
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error: unknown) {
    console.error(`--forces built:${path}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  const read = readBuiltForces(json)
  if ('problem' in read) {
    console.error(`--forces built:${path}: ${read.problem}`)
    process.exit(1)
  }
  return { kind: 'built', forces: read.forces }
}

/** `--ai <name>`: an opponent from the registry the app uses, or the fuzz opponent,
 *  which only the terminal offers. An unknown name is refused with the list. */
function aiArg(name: string | undefined): AiPlayer {
  if (name === undefined) return OPPONENTS[DEFAULT_OPPONENT]
  if (name === 'random') return randomAi
  const found = opponentNamed(name)
  if (found === null) {
    console.error(`unknown --ai ${name}; try ${[...OPPONENT_NAMES, 'random'].join(', ')}`)
    process.exit(1)
  }
  return OPPONENTS[found]
}

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const seedArg = get('--seed')
  return {
    seed: seedArg === undefined ? Math.floor(Math.random() * 100_000) : Number(seedArg),
    ai: aiArg(get('--ai')),
    // Watching a whole game is how a force is judged before there is a screen for it,
    // and the only way to play one through this client without typing every answer.
    self: get('--p1-ai') === undefined ? null : aiArg(get('--p1-ai')),
    // The seed decides the forces now. A name brings back one of the hand-authored
    // pairs instead -- `starter` is what the tests and the goldens play, `bestiary`
    // puts every monster and large die on the board.
    forces: forcesArg(get('--forces')),
  }
}

async function main() {
  const { seed, ai, self, forces }: { seed: number; ai: AiPlayer; self: AiPlayer | null; forces: ForceSpec } =
    parseArgs()
  const human: PlayerId = 'p1'

  let state = begin(setupGame({ seed, forces, ruleSet: V1_RULES }))

  // Which species you are is a roll now, so the banner reads it off the board
  // rather than stating it -- and the size too, since two sides need not match.
  const fielding = (player: PlayerId) =>
    `${speciesNames(forceSpecies(state, player))}, ${forceSize(state, player)} health`
  console.log(bold('\ndd_solo — Dragon Dice'))
  console.log(
    dim(
      `seed ${seed} · ${self === null ? 'you are' : `${self.name} plays`} p1 (${fielding('p1')}) · ` +
        `opponent is ${ai.name} (${fielding('p2')})`,
    ),
  )
  console.log(dim('q quits at any prompt. Nothing is saved.\n'))
  let aiRng: RngState = rngFrom(seed ^ 0x5eed)
  let shown = 0
  // Redraw the board when the situation changes, not before every prompt --
  // a march is several decisions and reprinting between each is just noise.
  let lastBoard = ''

  const flush = () => {
    for (const entry of state.log.slice(shown)) {
      const line = describe(entry, state)
      if (line !== null) console.log(line)
      for (const extra of mathLines(entry)) console.log(extra)
    }
    shown = state.log.length
  }

  flush()

  while (state.winner === null && state.pending !== null) {
    const pending = state.pending
    let action: GameAction

    if (pending.player === human) {
      const key = `${state.turn.marching}:${state.turn.phase}:${state.turn.marchIndex}:${state.turn.marchingArmy}`
      if (key !== lastBoard) {
        console.log(board(state, human))
        lastBoard = key
      }
      flush()
      if (self === null) {
        action = await askHuman(state, pending)
      } else {
        const [selfAction, nextRng] = self.decide(state, pending, aiRng)
        aiRng = nextRng
        action = selfAction
      }
    } else {
      const [aiAction, nextRng] = ai.decide(state, pending, aiRng)
      aiRng = nextRng
      action = aiAction
    }

    state = reduce(state, action)
    flush()
  }

  console.log(board(state, human))
  console.log(
    self !== null
      ? bold(`\n${state.winner} wins.`)
      : state.winner === human
        ? bold(green('\nYou win.'))
        : bold(red('\nYou lose.')),
  )
  rl.close()
}

main().catch((error: unknown) => {
  console.error(red(`\n${String(error)}`))
  rl.close()
  process.exit(1)
})
