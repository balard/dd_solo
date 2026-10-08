/**
 * The run's encounters (v3 Phase 1): `data/encounters.json` and the enemy forces in
 * `data/forces/enemies/`, read and checked at load.
 *
 * Hand-authored like `presets.json`, so a mistake fails loudly at module load, the way
 * `collections.ts` does it, rather than as a battle that cannot be set up halfway
 * through Act II. The checks are pure functions over parsed JSON and return **every**
 * problem, so a test can hand them a broken file and read what they say.
 *
 * **An enemy force is one file, not a pair.** `data/forces/` holds pairs, which is
 * what the terminal's `built:<file>` reads; a single force there would be a file that
 * flag cannot play. So the enemies have a directory of their own, read by a glob: a new
 * enemy is a data edit, not a code edit.
 *
 * **What this cannot check: that an opponent name is in `OPPONENTS`.** `src/run/` may not
 * import `src/ai/`, so `encounters.test.ts` checks every name against the registry, and
 * this refuses `random` by name -- it is the fuzz opponent, not an opponent.
 */
import encountersJson from '../../data/encounters.json'
import { DataError } from '../data/types'
import { builtForceHealth, builtForceProblem, readBuiltForce, type BuiltForce, type ForcePool } from '../engine/force'
import { speciesProblem } from '../engine/playable'

import { ACTS, ACT_SIZE, ENCOUNTERS_PER_ACT, type Act, type Encounter, type EnemySpec, type RunContent } from './types'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The enemy forces from their files, keyed by path, named by file name. */
export function readEnemyForces(
  files: Readonly<Record<string, unknown>>,
): { readonly forces: Readonly<Record<string, BuiltForce>>; readonly problems: readonly string[] } {
  const forces: Record<string, BuiltForce> = {}
  const problems: string[] = []
  for (const [path, json] of Object.entries(files)) {
    const name = path.replace(/^.*\//, '').replace(/\.json$/, '')
    const read = readBuiltForce(json, `enemy ${name}`)
    if ('problem' in read) {
      problems.push(read.problem)
      continue
    }
    const problem = builtForceProblem(read.force)
    if (problem !== null) problems.push(`enemy ${name}: ${problem}`)
    else forces[name] = read.force
  }
  return { forces, problems }
}

function readPool(raw: unknown, where: string, problems: string[]): ForcePool | null {
  if (!isRecord(raw)) return problems.push(`${where}: its pool is not an object`), null
  if (raw['kind'] === 'mixed') return { kind: 'mixed' }
  if (raw['kind'] !== 'species') return problems.push(`${where}: a pool is "species" or "mixed"`), null
  const species = raw['species']
  if (typeof species !== 'string') return problems.push(`${where}: its pool names no species`), null
  const problem = speciesProblem(species)
  if (problem !== null) return problems.push(`${where}: ${problem}`), null
  return { kind: 'species', species }
}

function readEnemy(
  raw: unknown,
  act: Act,
  where: string,
  forces: Readonly<Record<string, BuiltForce>>,
  problems: string[],
): EnemySpec | null {
  if (!isRecord(raw)) return problems.push(`${where}: a battle needs an enemy`), null
  const hasPool = 'pool' in raw
  const hasBuilt = 'built' in raw
  if (hasPool === hasBuilt) return problems.push(`${where}: an enemy is a pool or a built force, exactly one`), null
  if (hasPool) {
    const pool = readPool(raw['pool'], where, problems)
    return pool === null ? null : { pool }
  }
  const name = raw['built']
  if (typeof name !== 'string') return problems.push(`${where}: a built enemy names a file`), null
  const force = forces[name]
  if (force === undefined) {
    return problems.push(`${where}: there is no enemy force ${name} in data/forces/enemies/`), null
  }
  const health = builtForceHealth(force)
  if (health !== ACT_SIZE[act]) {
    problems.push(`${where}: ${name} is ${health} health, and Act ${act} meets ${ACT_SIZE[act]}`)
    return null
  }
  return { built: name }
}

function readEncounter(
  raw: unknown,
  act: Act,
  index: number,
  forces: Readonly<Record<string, BuiltForce>>,
  problems: string[],
): Encounter | null {
  const label = `act ${act}, encounter ${index + 1}`
  if (!isRecord(raw)) return problems.push(`${label}: not an object`), null
  const { id, kind, name } = raw
  if (typeof id !== 'string' || id === '') return problems.push(`${label}: it has no id`), null
  const where = `${id} (${label})`
  if (typeof name !== 'string' || name.trim() === '') return problems.push(`${where}: it has no name`), null
  if (kind === 'event') return { id, act, kind, name }
  if (kind !== 'battle') return problems.push(`${where}: its kind is "battle" or "event"`), null

  const opponent = raw['opponent']
  if (typeof opponent !== 'string' || opponent === '') return problems.push(`${where}: it names no opponent`), null
  if (opponent === 'random') {
    return problems.push(`${where}: random is the fuzz opponent, not an opponent`), null
  }
  const enemy = readEnemy(raw['enemy'], act, where, forces, problems)
  return enemy === null ? null : { id, act, kind, name, enemy, opponent }
}

/**
 * The run's content from parsed `encounters.json` and the enemy forces, or every
 * problem with it:
 * - one list per act, each holding **more** than twelve encounters and at least one of
 *   each kind, so a run can draw its twelve without replacement and still meet both;
 * - ids unique across the acts;
 * - every pool's species playable;
 * - every built enemy one of the forces, and its act's size;
 * - every enemy force used by some encounter -- a file nothing meets is a typo waiting.
 *
 * The forces are already legal by `builtForceProblem`: `readEnemyForces` drops one that
 * is not, and says so.
 */
export function readEncounters(
  value: unknown,
  forces: Readonly<Record<string, BuiltForce>>,
): { readonly content: RunContent } | { readonly problems: readonly string[] } {
  const problems: string[] = []
  if (!isRecord(value) || !isRecord(value['acts'])) return { problems: ['expected an object with acts 1, 2 and 3'] }
  const rawActs = value['acts']

  const acts = {} as Record<Act, readonly Encounter[]>
  const seen = new Set<string>()
  const used = new Set<string>()
  for (const act of ACTS) {
    const list = rawActs[String(act)]
    if (!Array.isArray(list)) {
      problems.push(`act ${act} has no list of encounters`)
      acts[act] = []
      continue
    }
    const encounters: Encounter[] = []
    list.forEach((raw: unknown, index) => {
      const encounter = readEncounter(raw, act, index, forces, problems)
      if (encounter === null) return
      if (seen.has(encounter.id)) problems.push(`${encounter.id} is used twice`)
      seen.add(encounter.id)
      if (encounter.kind === 'battle' && 'built' in encounter.enemy) used.add(encounter.enemy.built)
      encounters.push(encounter)
    })
    if (list.length <= ENCOUNTERS_PER_ACT) {
      problems.push(`act ${act} holds ${list.length} encounters; a run draws ${ENCOUNTERS_PER_ACT}, so it needs more`)
    }
    for (const kind of ['battle', 'event'] as const) {
      if (!encounters.some((e) => e.kind === kind)) problems.push(`act ${act} has no ${kind}`)
    }
    acts[act] = encounters
  }
  for (const name of Object.keys(forces)) {
    if (!used.has(name)) problems.push(`no encounter meets the enemy force ${name}`)
  }

  return problems.length > 0 ? { problems } : { content: { acts, forces } }
}

function load(): RunContent {
  const files = import.meta.glob<unknown>('../../data/forces/enemies/*.json', { eager: true, import: 'default' })
  const enemies = readEnemyForces(files)
  const read = readEncounters(encountersJson, enemies.forces)
  const problems = [...enemies.problems, ...('problems' in read ? read.problems : [])]
  if (problems.length > 0 || 'problems' in read) {
    throw new DataError(`data/encounters.json:\n  ${problems.join('\n  ')}`)
  }
  return read.content
}

/** Every encounter in the data and every enemy force: what a run draws from. */
export const RUN_CONTENT: RunContent = load()
