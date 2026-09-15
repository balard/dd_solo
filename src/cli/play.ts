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
 *   npm run play -- --forces starter   -- the two hand-authored 30-health lists
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { passiveAi } from '../ai/passive'
import { randomAi } from '../ai/random'
import type { AiPlayer } from '../ai/types'
import { SPECIES, terrainDie, terrainFaceAction, unitType } from '../data/load'
import type { TerrainFaceNumber } from '../data/types'
import { damageOptions } from '../engine/damage'
import { begin, reduce } from '../engine/reduce'
import { rngFrom, type RngState } from '../engine/rng'
import { setupGame, STARTER_FORCES, type ForceSpec } from '../engine/setup'
import {
  TERRAIN_SLOTS,
  armyAt,
  deadUnits,
  livingUnits,
  speciesOf,
  type GameAction,
  type GameState,
  type LogEntry,
  type Pending,
  type PlayerId,
  type TerrainSlot,
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

const SLOT_LABEL: Record<TerrainSlot, string> = {
  p1_home: 'P1 home',
  frontier: 'Frontier',
  p2_home: 'P2 home',
}

/** "melee" -> "Melee": the action reads as a name in a sentence, not a keyword. */
const actionName = (action: string) => action.charAt(0).toUpperCase() + action.slice(1)

const name = (unit: UnitInstance) => unitType(unit.typeId).name
/** "treefolk" -> "Treefolk": ids are the engine's vocabulary, not the player's. */
const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id
const health = (units: readonly UnitInstance[]) =>
  units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)

function armySummary(state: GameState, player: PlayerId, slot: TerrainSlot): string {
  const units = armyAt(state, player, slot)
  if (units.length === 0) return dim('    —    ')
  return `${units.length}d/${health(units)}h`.padEnd(9)
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
  }

  const reserve = (p: PlayerId) =>
    livingUnits(state, p).filter((u) => u.location.kind === 'reserve').length
  lines.push(
    dim(
      `  dead  P1 ${deadUnits(state, 'p1').length}  P2 ${deadUnits(state, 'p2').length}` +
        `   ·   reserve  P1 ${reserve('p1')}  P2 ${reserve('p2')}`,
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
      const sum =
        entry.saveTotal === null
          ? `${entry.attackTotal} ${entry.action}${entry.action === 'magic' ? ' ÷ 2' : ''}`
          : `${entry.attackTotal} ${entry.action} − ${entry.saveTotal} saves`
      return `  ${arrow}: ${sum} = ${bold(String(entry.damage))} damage`
    }
    case 'units_killed':
      return red(
        `  ${entry.player} loses ${entry.unitIds
          .map((id) => (state.units[id] ? name(state.units[id]!) : id))
          .join(', ')}`,
      )
    case 'counter_declined':
      return dim(`${entry.player} declines to counter-attack`)
    case 'victory':
      return bold(green(`\n*** ${entry.player} wins by ${entry.reason} ***`))
    case 'turn_end':
    case 'game_start':
    case 'terrain_placed':
    case 'reinforced':
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
async function askDamage(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind !== 'assign_damage') throw new Error('not damage')
  const army = armyAt(state, pending.player, pending.slot)
  const { required, suggestion } = damageOptions(army, pending.damage)

  if (required === 0) {
    console.log(dim(`  ${pending.damage} damage cannot kill anything — no die has few enough health`))
    return { kind: 'assign_damage', unitIds: [] }
  }

  const chosen = new Set<string>()
  for (;;) {
    const absorbed = [...chosen].reduce((sum, id) => sum + unitType(state.units[id]!.typeId).health, 0)
    console.log(
      `\n${bold(`Assign ${pending.damage} damage`)} — you must lose ${bold(String(required))} health ` +
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
    if (reply === 'a') return { kind: 'assign_damage', unitIds: suggestion }
    if (reply === 'c') {
      chosen.clear()
      continue
    }
    if (reply === '' && absorbed === required) {
      return { kind: 'assign_damage', unitIds: [...chosen] }
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

async function askUnits(state: GameState, pending: Pending): Promise<GameAction> {
  const player = pending.player
  const movable =
    pending.kind === 'reinforce'
      ? livingUnits(state, player).filter((u) => u.location.kind === 'reserve')
      : livingUnits(state, player).filter((u) => u.location.kind === 'terrain')

  const verb = pending.kind === 'reinforce' ? 'Reinforce' : 'Retreat'
  console.log(`\n${bold(verb)} ${dim('— space-separated numbers, or enter for none')}`)
  movable.forEach((unit, i) => {
    const where =
      unit.location.kind === 'terrain' ? SLOT_LABEL[unit.location.slot] : 'reserve'
    console.log(`  ${i + 1}) ${name(unit)} ${dim(`(${unitType(unit.typeId).health}h, ${where})`)}`)
  })

  const reply = (await ask('> ')).trim()
  const picked = reply
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => movable[Number(t) - 1])
    .filter((u): u is UnitInstance => u !== undefined)

  if (pending.kind === 'retreat') return { kind: 'retreat', unitIds: picked.map((u) => u.id) }

  if (picked.length === 0) return { kind: 'reinforce', moves: [] }
  console.log(dim('  send them to which terrain?'))
  TERRAIN_SLOTS.forEach((slot, i) => console.log(`  ${i + 1}) ${SLOT_LABEL[slot]}`))
  const slotReply = (await ask('> ')).trim()
  const slot = TERRAIN_SLOTS[Number(slotReply) - 1] ?? 'frontier'
  return { kind: 'reinforce', moves: picked.map((u) => ({ unitId: u.id, slot })) }
}

async function askHuman(state: GameState, pending: Pending): Promise<GameAction> {
  if (pending.kind === 'assign_damage') return askDamage(state, pending)
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
    // The seed decides the forces now. `--forces starter` brings back the two
    // hand-authored 30-health lists, which is what the tests still play.
    forces: get('--forces') === 'starter' ? STARTER_FORCES : ({ kind: 'random' } as ForceSpec),
  }
}

async function main() {
  const { seed, ai, forces }: { seed: number; ai: AiPlayer; forces: ForceSpec } = parseArgs()
  const human: PlayerId = 'p1'

  let state = begin(setupGame({ seed, forces }))

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
