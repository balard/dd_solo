/**
 * A whole run in the terminal (v3 Phase 2): `npm run play -- --run`.
 *
 * The terminal answers `run.pending` with menus, and a `battle` pending plays an ordinary
 * game through `play.ts`'s own loop, handed in as `playBattle`, then reports who won as
 * `battle_ended`. The run never sees the game, and the game never learns it is in a run.
 *
 * `--p1-ai <ai>` watches: the AI plays every battle and the autopilot (`src/run/autopilot.ts`)
 * answers everything else. `--brief` keeps the games off the screen, so a watched run
 * reads a line an encounter -- which is how a difficulty curve gets its first look. It is
 * not pacing data: an AI never concedes, and plays a game in a second.
 *
 * Nothing is saved: a run in the terminal lives as long as the process. Run saves are
 * Phase 3, and they are the app's.
 */
import { OPPONENTS, opponentNamed } from '../ai/opponents'
import type { AiPlayer } from '../ai/types'
import { SPECIES, dragonName, terrainDieName, unitType } from '../data/load'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../data/presets'
import { builtForceHealth, type BuiltForce } from '../engine/force'
import { forceHealth, forceProblems, healthOf } from '../engine/forceProblems'
import type { SetupOptions } from '../engine/setup'
import type { GameState } from '../engine/types'
import { autopilot } from '../run/autopilot'
import { battleSetup, enemyForce } from '../run/battle'
import { transformsOf, upgradeOf } from '../run/draws'
import { newRun, reduceRun } from '../run/reduce'
import {
  ACT_SIZE,
  ENCOUNTERS_PER_ACT,
  IllegalRunAction,
  RUN_PLAYER,
  type Act,
  type Offer,
  type RunAction,
  type RunState,
} from '../run/types'

import { arrangeCommand, owned, spareUnits } from './arrange'
import type { BattleOptions } from './play'
import { ask, bold, cyan, dim, green, red, yellow } from './term'

export interface RunOptions {
  readonly seed: number
  /** `--race`: picks the race rather than asking. */
  readonly race: string | null
  readonly self: AiPlayer | null
  readonly brief: boolean
  readonly playBattle: (setup: SetupOptions, options: BattleOptions) => Promise<GameState>
}

const ROMAN: Readonly<Record<Act, string>> = { 1: 'I', 2: 'II', 3: 'III' }

const speciesName = (id: string) => SPECIES.find((s) => s.id === id)?.name ?? id

const CLASS: Readonly<Record<string, string>> = {
  heavy_melee: 'heavy melee',
  light_melee: 'light melee',
  cavalry: 'cavalry',
  missile: 'missile',
  magic: 'magic',
}

/** "Oak Lord (Treefolk, 3 health, heavy melee)". A monster has no class line. */
function unitLine(id: string): string {
  const unit = unitType(id)
  const kind = unit.size === 'monster' ? 'monster' : CLASS[unit.unitClass]
  return `${unit.name} ${dim(`(${speciesName(unit.species)}, ${unit.health} health, ${kind})`)}`
}

function offerLine(offer: Offer): string {
  switch (offer.kind) {
    case 'unit':
      return unitLine(offer.id)
    case 'dragon':
      return `${dragonName(offer.id)} ${dim('(dragon)')}`
    case 'terrain':
      return `${terrainDieName(offer.id)} ${dim('(terrain)')}`
  }
}

/** "Act II · 4 of 12". */
const where = (run: RunState) => `Act ${ROMAN[run.act]} · ${run.encounter + 1} of ${ENCOUNTERS_PER_ACT}`

/** A force's species and size: "Coral Elves, 12 health, 8 dice". */
function forceLine(force: BuiltForce): string {
  const ids = PRESET_ARMY_NAMES.flatMap((army) => force.armies[army])
  const species = [...new Set(ids.map((id) => speciesName(unitType(id).species)))].join(' and ')
  return `${species}, ${builtForceHealth(force)} health, ${ids.length} dice`
}

const ARMY_LETTER: Readonly<Record<PresetArmyName, string>> = { home: 'h', campaign: 'c', horde: 'd' }

/** The arrangement screen: the force army by army, what it may still take, and what is wrong. */
function showArrangement(run: RunState, cap: number): void {
  const force = run.force
  const total = forceHealth(force)
  console.log(`\n  ${bold('Your force')} — ${total} / ${cap} health`)
  for (const army of PRESET_ARMY_NAMES) {
    const dice = force.armies[army].map((id, i) => `${i + 1} ${unitType(id).name}(${unitType(id).health})`)
    const health = `${healthOf(force.armies[army])}/${maxArmyHealth(total)}`
    console.log(`    ${ARMY_LETTER[army]}) ${army.padEnd(9)} ${dim(health.padEnd(6))} ${dice.join('  ') || dim('empty')}`)
  }
  const home = force.homeTerrain === undefined ? red('none') : terrainDieName(force.homeTerrain)
  const front = force.frontierProposal === undefined ? red('none') : terrainDieName(force.frontierProposal)
  const dragons = (force.dragons ?? []).map(dragonName).join(', ') || red('none')
  console.log(`    Home Terrain ${home} · Frontier proposal ${front} · dragons ${dragons}`)

  const spare = spareUnits(run)
  console.log(
    `  ${bold('Spare dice')}  ` +
      (spare.length === 0 ? dim('none') : spare.map((id, i) => `${i + 1} ${unitType(id).name}(${unitType(id).health})`).join('  ')),
  )
  const count = (kind: 'terrains' | 'dragons', id: string) => {
    const n = run.collection[kind][id] ?? 0
    return n > 1 ? dim(` ×${n}`) : ''
  }
  console.log(
    `  ${bold('Terrains')}    ` +
      owned(run, 'terrains').map((id, i) => `t${i + 1} ${terrainDieName(id)}${count('terrains', id)}`).join('  '),
  )
  console.log(
    `  ${bold('Dragons')}     ` + owned(run, 'dragons').map((id, i) => `d${i + 1} ${dragonName(id)}${count('dragons', id)}`).join('  '),
  )
  for (const problem of forceProblems(run.collection, cap, force, 'at_most')) console.log(red(`  · ${problem.text}`))
  console.log(
    dim(
      '  3 h  field spare die 3 (h home, c campaign, d horde) · x c 2  take one back · home t1 / front t2 · ' +
        'dragon d1 · auto · enter to fight · q quits',
    ),
  )
}

/** Answers `run.pending` once, through the autopilot or a menu. Null means quit. */
async function answer(run: RunState, options: RunOptions): Promise<RunAction | null> {
  const pending = run.pending
  const watching = options.self !== null
  switch (pending.kind) {
    case 'choose_race': {
      if (options.race !== null) {
        if (!pending.races.includes(options.race)) {
          throw new Error(`unknown --race ${options.race}; try ${pending.races.join(', ')}`)
        }
        return { kind: 'pick_race', race: options.race }
      }
      if (watching) return autopilot(run)
      console.log(`\n${bold('Pick a race')}`)
      pending.races.forEach((race, i) => console.log(`  ${i + 1}) ${speciesName(race)}`))
      for (;;) {
        const reply = (await ask('> ')).trim().toLowerCase()
        if (reply === 'q') return null
        const race = pending.races[Number(reply) - 1]
        if (race !== undefined) return { kind: 'pick_race', race }
        console.log(red('  pick a number from the list'))
      }
    }

    case 'arrange_force': {
      if (watching) return autopilot(run)
      showArrangement(run, pending.cap)
      for (;;) {
        const line = await ask('> ')
        const reply = arrangeCommand(run, pending.cap, line)
        switch (reply.kind) {
          case 'quit':
            return null
          case 'problem':
            console.log(red(`  ${reply.text}`))
            continue
          case 'force':
            return { kind: 'set_force', force: reply.force }
          case 'ready':
            if (forceProblems(run.collection, pending.cap, run.force, 'at_most').length > 0) {
              console.log(red('  the force cannot fight yet; fix what is listed above'))
              continue
            }
            return { kind: 'ready' }
        }
      }
    }

    case 'battle':
      throw new Error('a battle is played, not asked')

    case 'reward': {
      if (watching) return autopilot(run)
      console.log(`\n${bold(green('Victory.'))} ${bold('Pick a reward')} ${dim('-- it goes to your pool')}`)
      pending.offers.forEach((offer, i) => console.log(`  ${i + 1}) ${offerLine(offer)}`))
      for (;;) {
        const reply = (await ask('> ')).trim().toLowerCase()
        if (reply === 'q') return null
        const index = Number(reply) - 1
        if (pending.offers[index] !== undefined) return { kind: 'take_offer', index }
        console.log(red('  pick a number from the list'))
      }
    }

    case 'event': {
      if (watching) return autopilot(run)
      console.log(`\n${bold(pending.encounter.name)} ${dim('-- change one die in your pool, or walk on')}`)
      pending.transformable.forEach((id, i) => {
        const up = upgradeOf(id)
        const upgrade = up === null ? dim('cannot be upgraded') : `upgrades to ${unitType(up).name}`
        const into = transformsOf(id).map((t) => unitType(t).name).join(', ')
        console.log(`  ${i + 1}) ${unitLine(id)} -- ${upgrade}; transforms into one of ${into}`)
      })
      console.log(dim('  u 3  upgrade die 3 · t 3  transform it · s  skip · q quits'))
      for (;;) {
        const [verb, number] = (await ask('> ')).trim().toLowerCase().split(/\s+/)
        if (verb === 'q') return null
        if (verb === 's' || verb === 'skip') return { kind: 'skip' }
        const unit = pending.transformable[Number(number) - 1]
        if (unit !== undefined && verb === 'u' && pending.upgradable.includes(unit)) return { kind: 'upgrade', unit }
        if (unit !== undefined && verb === 't') return { kind: 'transform', unit }
        const problem =
          (verb !== 'u' && verb !== 't') || number === undefined
            ? 'u <n>, t <n> or s'
            : unit === undefined
              ? `there is no die ${number}`
              : `${unitType(unit).name} cannot be upgraded`
        console.log(red(`  ${problem}`))
      }
    }

    case 'over':
      throw new Error('the run is over')
  }
}

/** Plays the battle in hand to its end and returns who won. */
async function fight(run: RunState, options: RunOptions): Promise<RunAction> {
  if (run.pending.kind !== 'battle') throw new Error('no battle in hand')
  const encounter = run.pending.encounter
  const name = opponentNamed(encounter.opponent)
  if (name === null) throw new Error(`${encounter.id} names the opponent ${encounter.opponent}, which is not one`)
  const ai = OPPONENTS[name]
  const setup = battleSetup(run)
  const enemy = enemyForce(run)
  const state = await options.playBattle(setup, {
    ai,
    self: options.self,
    aiSeed: setup.seed,
    brief: options.brief,
    concedeWarning: 'Conceding loses this battle, and a lost battle ends the run.',
    banner: () =>
      `${where(run)} · ${encounter.name} · battle seed ${setup.seed} · ` +
      `you: ${forceLine(run.force)} · them: ${forceLine(enemy)}, played by ${ai.name}`,
  })
  if (state.winner === null) throw new Error('the battle ended with no winner')
  return { kind: 'battle_ended', winner: state.winner }
}

/** One line for what just happened, for a watched run and a played one alike. */
function narrate(before: RunState, action: RunAction, after: RunState): string | null {
  switch (action.kind) {
    case 'pick_race':
      return bold(`\nA ${speciesName(action.race)} run · seed ${before.seed}`) + dim(` · ${forceLine(after.force)}`)
    case 'set_force':
    case 'ready':
      return null
    case 'battle_ended': {
      const encounter = before.current
      const won = action.winner === RUN_PLAYER
      return `${where(before)} · ${encounter?.name ?? 'battle'} · ${won ? green('won') : red('lost')}` +
        dim(` with ${forceHealth(before.force)} of ${ACT_SIZE[before.act]} health fielded`)
    }
    case 'take_offer': {
      const offer = before.pending.kind === 'reward' ? before.pending.offers[action.index] : undefined
      return offer === undefined ? null : dim(`  took ${offerLine(offer)}`)
    }
    case 'upgrade':
    case 'transform': {
      const from = unitType(action.unit).name
      const gained = Object.keys(after.collection.units).find(
        (id) => (after.collection.units[id] ?? 0) > (before.collection.units[id] ?? 0),
      )
      const to = gained === undefined ? '?' : unitType(gained).name
      return `${where(before)} · ${before.current?.name ?? 'event'} · ${action.kind === 'upgrade' ? 'upgraded' : 'transformed'} ${from} into ${to}`
    }
    case 'skip':
      return `${where(before)} · ${before.current?.name ?? 'event'} · ${dim('walked on')}`
  }
}

/** Plays a whole run, from the race to won or lost, and prints how it went. */
export async function playRunInTerminal(options: RunOptions): Promise<RunState> {
  let run = newRun(options.seed)
  console.log(bold('\ndd_solo — a Dragon Dice run'))
  console.log(dim(`run seed ${options.seed} · three acts of twelve encounters · a lost battle ends the run · nothing is saved`))

  // Each battle is announced once, before its force is arranged, however many edits that takes.
  let lastAnnounced: string | null = null
  while (run.pending.kind !== 'over') {
    if (run.pending.kind === 'arrange_force' && options.self === null) {
      const encounter = run.current
      if (encounter?.kind === 'battle' && encounter.id !== lastAnnounced) {
        lastAnnounced = encounter.id
        console.log(`\n${bold(where(run))} · ${cyan(encounter.name)} · ${dim(`they field ${forceLine(enemyForce(run))}`)}`)
      }
    }
    const action = run.pending.kind === 'battle' ? await fight(run, options) : await answer(run, options)
    if (action === null) {
      console.log(dim('\nbye -- a run in the terminal is not saved'))
      return run
    }
    const before = run
    try {
      run = reduceRun(run, action)
    } catch (error) {
      if (!(error instanceof IllegalRunAction)) throw error
      console.log(red(`  ${error.message}`))
      continue
    }
    const line = narrate(before, action, run)
    if (line !== null) console.log(line)
  }

  console.log(
    run.status === 'won'
      ? bold(green(`\nThe run is won: all three acts cleared.`))
      : bold(red(`\nThe run is lost in Act ${ROMAN[run.act]}, at encounter ${run.encounter + 1} of ${ENCOUNTERS_PER_ACT}.`)),
  )
  const units = Object.entries(run.collection.units)
  const dice = units.reduce((n, [, c]) => n + c, 0)
  const health = units.reduce((n, [id, c]) => n + unitType(id).health * c, 0)
  console.log(
    dim(`Your pool: ${dice} dice, ${health} health · dragons ${owned(run, 'dragons').map(dragonName).join(', ')}`),
  )
  if (run.status === 'lost') console.log(yellow('A defeat ends the run. Start another with npm run play -- --run.'))
  return run
}
