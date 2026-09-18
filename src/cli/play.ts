/**
 * A terminal client, so the game can be played before any UI exists.
 *
 * This is the hedge against Phase 7 overrunning: the rules become playable, and
 * therefore judgeable, weeks before there is a board to look at. It is also the
 * fastest way to find rules bugs that tests did not think to ask about.
 *
 *   npm run play               -- you are p1, PassiveAI is p2
 *   npm run play -- --seed 42  -- a specific game
 *   npm run play -- --ai random
 *   npm run play -- --forces starter    -- the two hand-authored 30-health lists
 *   npm run play -- --forces bestiary   -- every monster and large die, so every SAI
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { passiveAi } from '../ai/passive'
import { randomAi } from '../ai/random'
import type { AiPlayer } from '../ai/types'
import { SPECIES, terrainDie, terrainFaceAction, unitType } from '../data/load'
import type { TerrainFaceNumber } from '../data/types'
import { damageOptions } from '../engine/damage'
import { growthPartners, promotionGain } from '../engine/dua'
import { isAsleep } from '../engine/effects'
import { begin, reduce } from '../engine/reduce'
import { rngFrom, type RngState } from '../engine/rng'
import { saiPhrase, type DieRoll } from '../engine/roll'
import { SAI_TEXT } from '../engine/sai'
import { rollOnTheTable } from '../engine/turn'


import { FORCE_SETS, namedForces, setupGame, type ForceSpec } from '../engine/setup'
import {
  FULL_RULES,
  TERRAIN_SLOTS,
  armyAt,
  buriedUnits,
  deadUnits,

  livingUnits,
  speciesOf,
  type GameAction,
  type GameState,
  type LogEntry,
  type Pending,
  type PlayerId,
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

const SLOT_LABEL: Record<TerrainSlot, string> = {
  p1_home: 'P1 home',
  frontier: 'Frontier',
  p2_home: 'P2 home',
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
  const who = state.turn.marching === human ? green('you march') : red('opponent marches')
  lines.push(bold(`\n── Turn ${turn} · ${who} ` + '─'.repeat(34)))

  for (const slot of TERRAIN_SLOTS) {
    const terrain = state.terrains[slot]
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

function describe(entry: LogEntry, state: GameState): string | null {
  switch (entry.kind) {
    case 'forces_drawn':
      return dim(
        `forces rolled: ${entry.health} health a side — ` +
          `p1 ${speciesName(entry.species.p1)} (${entry.dice.p1} dice), ` +
          `p2 ${speciesName(entry.species.p2)} (${entry.dice.p2} dice)`,
      )
    case 'order_of_play':
      return dim(`Horde roll-off ${entry.rolls.p1}–${entry.rolls.p2}: ${entry.firstPlayer} marches first`)
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
    case 'action_chosen':
      return `${entry.player} does a ${bold(actionName(entry.action))} attack ${
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
      return `  ${arrow}: ${sum} = ${bold(String(entry.damage))} damage${back}`

    }
    case 'units_killed':
      return red(
        `  ${entry.player} loses ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')}`,
      )
    case 'units_risen':
      return green(
        `  ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')} rises from the ashes into ${entry.player}'s reserves`,
      )
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
        entry.escaped.length === 0
          ? 'none get away'
          : entry.toReserve === true
            ? `${who} escape${one} to ${entry.player}'s reserves`
            : `${who} get${one} away`
      return yellow(`  ${bold(entry.sai)}: ${asked} or die — ${got}`)
    }
    // Says when it ends as well as what it hit: an effect with a duration is the one
    // thing in the log that is still true on the next line.
    case 'effect_cast': {
      const unit = entry.unitId === undefined ? undefined : state.units[entry.unitId]
      const what = unit ? name(unit) : `${entry.target}'s army at ${SLOT_LABEL[entry.slot]}`
      return cyan(
        `  ${bold(entry.source)} catches ${what}` +
          dim(` — until the start of ${entry.player}'s next turn`),
      )
    }
    // Both halves of one decision: what the budget bought, and what it did not.
    case 'units_promoted': {
      const grown = entry.pairs
        .map((pair) => `${nameOf(state, pair.unitId)} -> ${nameOf(state, pair.partnerId)}`)
        .join(', ')
      const saves = entry.saveResults === undefined ? '' : `${entry.saveResults} save results`
      return green(
        `  ${bold(entry.sai)}: ${[grown, saves].filter(Boolean).join(' and ') || 'nothing'}`,
      )
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
          .join(', ')} ${entry.unitIds.length === 1 ? 'is' : 'are'} buried — no resurrection`,
      )
    case 'effects_expired':
      return dim(`${entry.sources.join(', ')} wears off at the start of ${entry.player}'s turn`)

    case 'counter_declined':
      return dim(`${entry.player} declines to counter-attack`)

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

function choicesFor(pending: Pending): Choice[] {
  switch (pending.kind) {
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

    case 'reinforce':
    case 'retreat':
    case 'assign_damage':
    case 'sai_target':
    case 'sai_target_army':
    // Their own sheets, like damage: a list of dice and a tally is not a menu.
    case 'sai_promote':
    case 'sai_move':
      return [] // handled separately
  }
}

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
    armyAt(state, pending.player, pending.slot),
    pending.damage,
    `Assign ${pending.damage} damage — you must lose`,
    `${pending.damage} damage cannot kill anything — no die has few enough health`,
  )
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
  const army = armyAt(state, pending.target, pending.slot).filter(
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
    const army = armyAt(state, pending.player, pending.slot).filter(
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
  const others = armyAt(state, pending.player, pending.slot).filter(
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

  console.log(`\n${bold('Retreat')} ${dim('— space-separated numbers, or enter for none')}`)
  movable.forEach((unit, i) => {
    const where = unit.location.kind === 'terrain' ? SLOT_LABEL[unit.location.slot] : 'reserve'
    console.log(`  ${i + 1}) ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h, ${where})`)}`)
  })

  const picked = pick(movable, (await ask('> ')).trim())
  return { kind: 'retreat', unitIds: picked.map((u) => u.id) }
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
  if (pending.kind === 'sai_target') return askSaiTarget(state, pending)
  if (pending.kind === 'sai_target_army') return askSaiTargetArmy(state, pending)
  if (pending.kind === 'sai_promote') return askSaiPromote(state, pending)
  if (pending.kind === 'sai_move') return askSaiMove(state, pending)
  if (pending.kind === 'reinforce' || pending.kind === 'retreat') return askUnits(state, pending)

  const choices = choicesFor(pending)
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
 *  answered with the list rather than a silent fallback to random. */
function forcesArg(name: string | undefined): ForceSpec {
  if (name === undefined) return { kind: 'random' }
  const found = namedForces(name)
  if (found === null) {
    console.error(
      `unknown --forces ${name}; try ${Object.keys(FORCE_SETS).join(', ')}, or omit it to roll them`,
    )
    process.exit(1)
  }
  return found
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
    ai: get('--ai') === 'random' ? randomAi : passiveAi,
    // The seed decides the forces now. A name brings back one of the hand-authored
    // pairs instead -- `starter` is what the tests and the goldens play, `bestiary`
    // puts every monster and large die on the board.
    forces: forcesArg(get('--forces')),
  }
}

async function main() {
  const { seed, ai, forces }: { seed: number; ai: AiPlayer; forces: ForceSpec } = parseArgs()
  const human: PlayerId = 'p1'

  let state = begin(setupGame({ seed, forces, ruleSet: FULL_RULES }))

  // Which species you are is a roll now, so the banner reads it off the board
  // rather than stating it.
  const fielding = (player: PlayerId) => speciesName(speciesOf(state, player))
  console.log(bold('\ndd_solo — Dragon Dice'))
  console.log(
    dim(
      `seed ${seed} · you are p1 (${fielding('p1')}) · ` +
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
      action = await askHuman(state, pending)
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
    state.winner === human ? bold(green('\nYou win.')) : bold(red('\nYou lose.')),
  )
  rl.close()
}

main().catch((error: unknown) => {
  console.error(red(`\n${String(error)}`))
  rl.close()
  process.exit(1)
})
