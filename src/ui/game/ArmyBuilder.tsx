/**
 * The army builder (v2 Phase 4b): dice into three armies, a Home Terrain, a Frontier
 * proposal and the dragons, picked from a collection.
 *
 * One component, two modes, and no mode flag: the full mode is the full collection and a
 * limited mode is any other, so everything that differs between them -- copies left,
 * whether a terrain or a dragon may be left to the draw -- is a question `builder.ts`
 * asks of the collection. Every rule lives there; this shows the answers, and never
 * decides one. Each problem sits beside the section it is about.
 *
 * One gesture per job, as on the board: tap a die in the collection to add it to the
 * army you are filling, tap a die in an army to take it back. "Look at dice" turns every
 * tap into inspecting, as the decision dock's toggle does.
 *
 * Kept forces live in `forceStore.ts`, per viewer. Starting a game with one is the start
 * screen's (4c).
 */
import { useCallback, useMemo, useState } from 'react'

import {
  COLLECTIONS,
  FULL_COLLECTION,
  collectionNamed,
  ownsEveryDie,
  type Collection,
} from '../../data/collections'
import { TERRAIN_TYPES, dragonDie, dragonName, terrainDie, terrainDieName, unitType } from '../../data/load'
import { PRESET_ARMY_NAMES, type PresetArmyName } from '../../data/presets'
import { dragonCount, type BuiltForce } from '../../engine/force'
import {
  forceHealth,
  forceProblems,
  type ForceProblem,
  type ProblemPlace,
  type TerrainField,
} from '../../engine/forceProblems'
import { V1_RULES } from '../../engine/types'

import { DragonDetail, DragonTileBody, TerrainDetail } from './Board'
import {
  EMPTY_FORCE,
  FORCE_CAPS,
  addDragon,
  addUnit,
  armyLines,
  defaultCap,
  defaultForceName,
  palette,
  removeDragon,
  removeUnit,
  setTerrain,
  terrainChoices,
  unitPalette,
} from './builder'
import { UnitDetail, UnitTileBody, describe } from './DiceGrid'
import { ElementDots, speciesInfo } from './Elements'
import {
  newForceId,
  readSavedForces,
  removeForce,
  upsertForce,
  writeSavedForces,
  type SavedForce,
} from './forceStore'
import { InspectorPanel } from './Inspector'
import { compareForDisplay } from './prompts'
import { tileSize } from './stacks'
import { RuleSetProvider } from './useRuleSet'

/** What each army is for, in the words the start screen uses. */
const ARMY_TEXT: Readonly<Record<PresetArmyName, { readonly name: string; readonly where: string }>> = {
  home: { name: 'Home', where: 'starts on your Home Terrain' },
  campaign: { name: 'Campaign', where: 'starts at the Frontier' },
  horde: { name: 'Horde', where: "starts on the enemy's Home Terrain" },
}

const TERRAIN_TEXT: Readonly<Record<TerrainField, string>> = {
  homeTerrain: 'Home Terrain',
  frontierProposal: 'Frontier proposal',
}

type Looking = { readonly kind: 'unit'; readonly typeId: string } | { readonly kind: 'dragon'; readonly dieId: string }

/** "×2" on a limited palette tile; nothing in the full collection, where it is endless. */
const leftLabel = (left: number): string | null => (left === Infinity ? null : `×${Math.max(0, left)}`)

function Problems({ problems, where }: { problems: readonly ForceProblem[]; where: ProblemPlace }) {
  const here = problems.filter((p) => p.where === where)
  if (here.length === 0) return null
  return (
    <ul className="builder-problems">
      {here.map((p) => (
        <li key={p.text}>{p.text}</li>
      ))}
    </ul>
  )
}

function UnitButton({
  typeId,
  compact = false,
  left = null,
  disabled = false,
  onClick,
  action,
}: {
  typeId: string
  compact?: boolean
  left?: string | null
  disabled?: boolean
  onClick: () => void
  /** What a tap does, for the tooltip and the screen reader: "add", "take back", "look". */
  action: string
}) {
  const side = tileSize(typeId, compact)
  const label = `${describe(unitType(typeId))} — ${action}`
  return (
    <div className={`die-wrap builder-die ${left !== null ? 'has-left' : ''}`}>
      <button
        type="button"
        className="die die-squared die-selectable"
        style={{ width: side, height: side }}
        disabled={disabled}
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        <UnitTileBody typeId={typeId} compact={compact} />
      </button>
      {left !== null && (
        <span className="die-count" aria-hidden="true">
          {left}
        </span>
      )}
    </div>
  )
}

function DragonButton({
  dieId,
  left = null,
  disabled = false,
  onClick,
  action,
}: {
  dieId: string
  left?: string | null
  disabled?: boolean
  onClick: () => void
  action: string
}) {
  const label = `${dragonName(dieId)} — ${action}`
  return (
    <div className="die-wrap builder-die">
      <button
        type="button"
        className={`dragon-tile dragon-el-${dragonDie(dieId).element}`}
        disabled={disabled}
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        <DragonTileBody dieId={dieId} />
      </button>
      {left !== null && (
        <span className="die-count" aria-hidden="true">
          {left}
        </span>
      )}
    </div>
  )
}

/** The eight-face sheet of whichever die a terrain field names, under its picker. */
function TerrainField({
  field,
  force,
  collection,
  problems,
  onChange,
}: {
  field: TerrainField
  force: BuiltForce
  collection: Collection
  problems: readonly ForceProblem[]
  onChange: (dieId: string | null) => void
}) {
  const chosen = force[field]
  const choices = terrainChoices(collection, force, field)
  const drawable = ownsEveryDie(collection, 'terrains')
  const byType = TERRAIN_TYPES.map((type) => ({
    type,
    dice: choices.filter((c) => terrainDie(c.id).type === type.id),
  })).filter((group) => group.dice.length > 0)

  return (
    <div className="builder-terrain">
      <label className="new-game-field">
        <span className="new-game-label">{TERRAIN_TEXT[field]}</span>
        <select value={chosen ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
          <option value="">{drawable ? 'Drawn at setup' : 'Choose one…'}</option>
          {byType.map(({ type, dice }) => (
            <optgroup key={type.id} label={type.name}>
              {dice.map((die) => (
                <option key={die.id} value={die.id} disabled={die.left <= 0}>
                  {terrainDieName(die.id)}
                  {die.left !== Infinity ? ` (${Math.max(0, die.left)} left)` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {chosen !== undefined && terrainDieExists(chosen) && <TerrainDetail terrain={{ dieId: chosen }} />}
      {chosen === undefined && drawable && (
        <p className="empty">
          {field === 'homeTerrain'
            ? 'Setup draws one of your largest species’ own type.'
            : 'Setup draws one sharing an element with your largest species.'}
        </p>
      )}
      <Problems problems={problems} where={field} />
    </div>
  )
}

function terrainDieExists(id: string): boolean {
  try {
    terrainDie(id)
    return true
  } catch {
    return false
  }
}

export function ArmyBuilder({
  onClose,
}: {
  /** Back to the start screen, with the id of a kept force to play, or null. */
  onClose: (play: string | null) => void
}) {
  const [saved, setSaved] = useState<readonly SavedForce[]>(() => readSavedForces())
  const [editing, setEditing] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState(FULL_COLLECTION.id)
  const collection = collectionNamed(collectionId) ?? FULL_COLLECTION
  const [cap, setCap] = useState(() => defaultCap(collection))
  const [name, setName] = useState('')
  const [force, setForce] = useState<BuiltForce>(EMPTY_FORCE)
  const [active, setActive] = useState<PresetArmyName>('home')
  const [looking, setLooking] = useState(false)
  const [inspect, setInspect] = useState<Looking | null>(null)
  const closeInspector = useCallback(() => setInspect(null), [])

  const problems = useMemo(() => forceProblems(collection, cap, force), [collection, cap, force])
  const health = forceHealth(force)
  const lines = armyLines(force)
  const units = unitPalette(collection, force)
  const dragonsOwned = palette(collection, force, 'dragons')
  const wanted = dragonCount(health)
  const title = name.trim() === '' ? defaultForceName(force) : name.trim()

  const store = (next: readonly SavedForce[]) => {
    setSaved(next)
    writeSavedForces(next)
  }

  const save = (asNew: boolean): string => {
    const id = editing !== null && !asNew ? editing : newForceId(saved, Date.now())
    store(upsertForce(saved, { id, name: title, collection: collection.id, cap, force }))
    setEditing(id)
    setName(title)
    return id
  }

  const load = (entry: SavedForce) => {
    const from = collectionNamed(entry.collection) ?? FULL_COLLECTION
    setEditing(entry.id)
    setCollectionId(from.id)
    setCap(entry.cap)
    setName(entry.name)
    setForce(entry.force)
    setActive('home')
  }

  const startOver = () => {
    setEditing(null)
    setName('')
    setForce(EMPTY_FORCE)
    setActive('home')
  }

  const chooseCollection = (id: string) => {
    const next = collectionNamed(id) ?? FULL_COLLECTION
    setCollectionId(next.id)
    setCap(defaultCap(next))
  }

  const unitTap = (typeId: string, act: () => void) => (looking ? setInspect({ kind: 'unit', typeId }) : act())
  const dragonTap = (dieId: string, act: () => void) => (looking ? setInspect({ kind: 'dragon', dieId }) : act())

  return (
    <RuleSetProvider ruleSet={V1_RULES}>
      <div className="app">
        <div className="builder">
          <div className="builder-head">
            <h1>Army builder</h1>
            <button type="button" className="choice secondary" onClick={() => onClose(null)}>
              Back
            </button>
          </div>

          <div className="builder-settings">
            <label className="new-game-field">
              <span className="new-game-label">Build from</span>
              <select value={collection.id} onChange={(e) => chooseCollection(e.target.value)}>
                {COLLECTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="new-game-field">
              <span className="new-game-label">Force size</span>
              <select value={cap} onChange={(e) => setCap(Number(e.target.value))}>
                {FORCE_CAPS.map((c) => (
                  <option key={c} value={c}>
                    up to {c} health
                  </option>
                ))}
              </select>
            </label>
            <label className="new-game-field builder-name">
              <span className="new-game-label">Name</span>
              <input
                type="text"
                value={name}
                placeholder={defaultForceName(force)}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>

          <p className={`builder-total ${health > cap ? 'is-over' : ''}`}>
            <b>
              {health} / {cap}
            </b>{' '}
            health · {lines.reduce((n, l) => n + l.dice, 0)} dice · each army at most{' '}
            {lines[0]?.half ?? 0}
            <span className={problems.length === 0 ? 'builder-ready' : 'muted'}>
              {problems.length === 0
                ? ' · ready to play'
                : ` · ${problems.length} thing${problems.length === 1 ? '' : 's'} to fix`}
            </span>
          </p>
          <Problems problems={problems} where="force" />

          <section className="builder-armies" aria-label="Armies">
            {PRESET_ARMY_NAMES.map((army) => {
              const line = lines.find((l) => l.army === army)
              const ids = force.armies[army]
              const order = ids.map((id, index) => ({ id, index }))
              order.sort((a, b) => compareForDisplay(unitType(a.id), unitType(b.id)))
              const isActive = active === army
              return (
                <div key={army} className={`builder-army ${isActive ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    className="builder-army-head"
                    aria-pressed={isActive}
                    onClick={() => setActive(army)}
                    title={`Add dice to the ${ARMY_TEXT[army].name} army`}
                  >
                    <b>{ARMY_TEXT[army].name}</b>
                    <span className={line !== undefined && line.health > line.half ? 'is-over' : 'muted'}>
                      {line?.health ?? 0} / {line?.half ?? 0}
                    </span>
                    <span className="muted builder-army-where">{ARMY_TEXT[army].where}</span>
                  </button>
                  <div className="dice-grid">
                    {order.map(({ id, index }) => (
                      <UnitButton
                        key={`${id}#${index}`}
                        typeId={id}
                        action={looking ? 'look' : 'take back'}
                        onClick={() => unitTap(id, () => setForce(removeUnit(force, army, index)))}
                      />
                    ))}
                    {ids.length === 0 && (
                      <p className="empty">
                        {isActive ? 'Tap a die below to add it here.' : 'Tap here, then a die below.'}
                      </p>
                    )}
                  </div>
                  <Problems problems={problems} where={army} />
                </div>
              )
            })}
          </section>

          <section className="builder-section" aria-label="Dice">
            <div className="builder-section-head">
              <h2>
                {looking ? 'Tap a die to look at it' : `Tap a die to add it to ${ARMY_TEXT[active].name}`}
              </h2>
              <button
                type="button"
                className="choice secondary"
                aria-pressed={looking}
                onClick={() => setLooking(!looking)}
              >
                {looking ? 'Done looking' : 'Look at dice'}
              </button>
            </div>
            {units.map((group) => {
              const species = speciesInfo(group.species)
              return (
                <div key={group.species} className="builder-species">
                  <p className="builder-species-name">
                    {species?.name ?? group.species}
                    {species && <ElementDots elements={species.elements} />}
                  </p>
                  <div className="dice-grid builder-palette">
                    {group.dice.map((die) => (
                      <UnitButton
                        key={die.id}
                        typeId={die.id}
                        compact
                        left={leftLabel(die.left)}
                        disabled={!looking && die.left <= 0}
                        action={looking ? 'look' : `add to ${ARMY_TEXT[active].name}`}
                        onClick={() => unitTap(die.id, () => setForce(addUnit(force, active, die.id)))}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </section>

          <section className="builder-section" aria-label="Terrain">
            <h2>Terrain</h2>
            <div className="builder-terrains">
              {(['homeTerrain', 'frontierProposal'] as const).map((field) => (
                <TerrainField
                  key={field}
                  field={field}
                  force={force}
                  collection={collection}
                  problems={problems}
                  onChange={(dieId) => setForce(setTerrain(force, field, dieId))}
                />
              ))}
            </div>
            <Problems problems={problems} where="terrains" />
          </section>

          <section className="builder-section" aria-label="Dragons">
            <h2>
              Dragons <span className="muted">· {wanted} for {health} health, one per 24 or part of it</span>
            </h2>
            <div className="dragon-row">
              {(force.dragons ?? []).map((dieId, index) => (
                <DragonButton
                  key={`${dieId}#${index}`}
                  dieId={dieId}
                  action={looking ? 'look' : 'take back'}
                  onClick={() => dragonTap(dieId, () => setForce(removeDragon(force, index)))}
                />
              ))}
              {force.dragons === undefined && (
                <p className="empty">
                  {ownsEveryDie(collection, 'dragons')
                    ? 'None chosen: setup draws them.'
                    : 'None chosen yet. Tap one below.'}
                </p>
              )}
            </div>
            <p className="builder-species-name">From the collection</p>
            <div className="dragon-row">
              {dragonsOwned.map((die) => (
                <DragonButton
                  key={die.id}
                  dieId={die.id}
                  left={leftLabel(die.left)}
                  disabled={!looking && die.left <= 0}
                  action={looking ? 'look' : 'add'}
                  onClick={() => dragonTap(die.id, () => setForce(addDragon(force, die.id)))}
                />
              ))}
            </div>
            <Problems problems={problems} where="dragons" />
          </section>

          <section className="builder-section" aria-label="Kept forces">
            <div className="choices">
              {/* Keeps the force as it stands, then hands it to the start screen as your
                  side (4c). Only a ready force, since the start screen would refuse it. */}
              <button
                type="button"
                className="choice"
                disabled={problems.length > 0}
                title={problems.length > 0 ? 'Fix what is listed first' : undefined}
                onClick={() => onClose(save(false))}
              >
                Keep and play it
              </button>
              <button type="button" className="choice secondary" onClick={() => save(false)}>
                {editing === null ? `Keep “${title}”` : `Save “${title}”`}
              </button>
              {editing !== null && (
                <button type="button" className="choice secondary" onClick={() => save(true)}>
                  Keep as a new force
                </button>
              )}
              <button type="button" className="choice secondary" onClick={startOver}>
                Start a new force
              </button>
            </div>

            <h2>Kept forces</h2>
            {saved.length === 0 ? (
              <p className="empty">None yet. A kept force stays in this browser.</p>
            ) : (
              <ul className="builder-kept">
                {saved.map((entry) => {
                  const from = collectionNamed(entry.collection) ?? FULL_COLLECTION
                  const count = forceProblems(from, entry.cap, entry.force).length
                  return (
                    <li key={entry.id} className={entry.id === editing ? 'is-editing' : ''}>
                      <span className="builder-kept-name">
                        <b>{entry.name}</b>
                        <span className="muted">
                          {' '}
                          · {forceHealth(entry.force)} health · {from.name} ·{' '}
                          {count === 0 ? 'ready' : `${count} to fix`}
                        </span>
                      </span>
                      <button type="button" className="choice secondary" onClick={() => load(entry)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="choice secondary"
                        onClick={() => {
                          if (!window.confirm(`Forget “${entry.name}”?`)) return
                          store(removeForce(saved, entry.id))
                          if (entry.id === editing) setEditing(null)
                        }}
                      >
                        Forget
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {inspect !== null && (
          <InspectorPanel onClose={closeInspector}>
            {inspect.kind === 'unit' ? (
              <UnitDetail typeId={inspect.typeId} />
            ) : (
              <DragonDetail dieId={inspect.dieId} whose={null} />
            )}
          </InspectorPanel>
        )}
      </div>
    </RuleSetProvider>
  )
}
