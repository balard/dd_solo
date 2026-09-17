/**
 * The board: all three terrains, each with the armies standing on it.
 *
 * This replaced a compact strip plus a single expanded "focused" terrain below it.
 * The strip told you where each terrain stood but not who was there, so judging a
 * move meant tapping between terrains and holding the other two in your head --
 * which is precisely the thing a board is for. Showing every army all the time costs
 * vertical space and buys back the whole point of having a board.
 *
 * Because everything is visible, there is no "look elsewhere" any more: `focused` is
 * now only a highlight marking where the current decision applies.
 */
import { terrainDie, terrainFaceAction, terrainType, unitType } from '../../data/load'
import type { TerrainFaceNumber } from '../../data/types'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type PlayerId,
  type TerrainInPlay,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../../engine/types'

import { DiceGrid } from './DiceGrid'
import { ElementDots, speciesInfo } from './Elements'
import { Glyph, type GlyphName } from './Glyph'
import { selectableAt, sleepingIds, slotLabel, type SelectMode } from './prompts'
import { useFaceArt } from './useFaceArt'

/**
 * The terrain die face.
 *
 * The real art has the number drawn into it, so when it is available it replaces
 * both the number and the glyph -- it *is* the die face. Without it, the number
 * plus our glyph says the same thing.
 */
function renderFace(
  art: ReturnType<typeof useFaceArt>,
  terrain: GameState['terrains'][TerrainSlot],
  icon: GlyphName | null,
) {
  const die = terrainDie(terrain.dieId)

  if (terrain.face === 8) {
    const url = art.eighthFace(die.eighthFace)
    const label = die.eighthFace.replace('_', ' ')
    return url !== null ? (
      <img className="chip-art" src={url} width={30} height={30} alt={label} title={label} />
    ) : (
      <span className="chip-eighth">{label}</span>
    )
  }

  const url = art.terrainFace(die.type, terrain.face)
  const label = `face ${terrain.face} — ${icon?.toLowerCase() ?? ''}`

  // The real art has the face number drawn into it, so printing the digit beside it
  // says the same thing twice. Our glyph does not, so the fallback keeps it -- which
  // is also the fresh-clone path, where no art has been fetched at all.
  if (url !== null) {
    return <img className="chip-art" src={url} width={34} height={34} alt={label} title={label} />
  }
  return (
    <>
      <span className="chip-number">{terrain.face}</span>
      {icon && <Glyph name={icon} size={15} />}
    </>
  )
}

const TERRAIN_FACES: readonly TerrainFaceNumber[] = [1, 2, 3, 4, 5, 6, 7]

/**
 * Every face of a terrain die, the same inspection the unit dice get.
 *
 * This is the one place the three types actually differ. All of them run magic ->
 * missile -> melee as the number rises, but the split points move: Wasteland has a
 * single magic face, Highland three. Playing against a terrain without being able to
 * see that is playing blind -- you cannot tell whether turning it up helps you.
 *
 * Face 8 is shown alongside but set apart: it comes from the die's eighth-face icon
 * rather than its type, and in v0 it only captures.
 */
export function TerrainDetail({ terrain }: { terrain: TerrainInPlay }) {
  const art = useFaceArt()
  const die = terrainDie(terrain.dieId)
  const type = terrainType(die.type)
  const eighthLabel = die.eighthFace.replace(/_/g, ' ')
  const eighthUrl = art.eighthFace(die.eighthFace)

  return (
    <div className="terrain-detail">
      <p className="detail-head">
        <b>{type.name}</b>
        <span className="muted">eighth face: {eighthLabel}</span>
        <ElementDots elements={type.elements} title={type.elements.join(' + ')} />
      </p>

      <div className="face-sheet">
        {TERRAIN_FACES.map((number) => {
          const icon = type.faces[number] as GlyphName
          const url = art.terrainFace(die.type, number)
          const label = `face ${number} — ${icon.toLowerCase()}`
          return (
            <span
              key={number}
              className={
                `sheet-face terrain-sheet-face i-${icon}` +
                (terrain.face === number ? ' is-current' : '')
              }
              title={label}
            >
              <span className="sheet-number">{number}</span>
              {url !== null ? (
                <img className="terrain-face-art" src={url} width={44} height={44} alt={label} />
              ) : (
                <Glyph name={icon} size={22} />
              )}
            </span>
          )
        })}

        <span
          className={'sheet-face terrain-sheet-face is-eighth' + (terrain.face === 8 ? ' is-current' : '')}
          title={`face 8 — ${eighthLabel}`}
        >
          <span className="sheet-number">8</span>
          {eighthUrl !== null ? (
            <img
              className="terrain-face-art"
              src={eighthUrl}
              width={44}
              height={44}
              alt={eighthLabel}
            />
          ) : (
            <span className="chip-eighth">{eighthLabel}</span>
          )}
        </span>
      </div>
    </div>
  )
}

function strength(units: readonly { typeId: string }[]) {
  return { dice: units.length, health: units.reduce((n, u) => n + unitType(u.typeId).health, 0) }
}

type Species = ReturnType<typeof speciesInfo>

function ArmySide({
  title,
  species,
  units,
  selectable,
  asleep,
  selected,
  onToggle,
  inspecting,
  onInspect,
}: {
  title: string
  species: Species
  units: readonly UnitInstance[]
  selectable: boolean
  asleep: ReadonlySet<UnitId>
  selected: ReadonlySet<UnitId>
  onToggle: (id: UnitId) => void
  inspecting: UnitId | null
  onInspect: (id: UnitId | null) => void
}) {
  const { dice, health } = strength(units)
  return (
    <section className="army card-army">
      <h3>
        {title}
        {species && (
          <>
            {' '}
            <span className="muted">{species.name}</span>
            <ElementDots elements={species.elements} />
          </>
        )}{' '}
        <span className="muted">
          {dice}d / {health}h
        </span>
      </h3>
      <DiceGrid
        units={units}
        selectable={selectable}
        asleep={asleep}
        selected={selected}
        onToggle={onToggle}
        inspecting={inspecting}
        onInspect={onInspect}
      />
    </section>
  )
}

export function Board({
  state,
  human,
  focused,
  openTerrain,
  onToggleFaces,
  selectMode,
  selected,
  onToggle,
  inspecting,
  onInspect,
  mySpecies,
  theirSpecies,
}: {
  state: GameState
  human: PlayerId
  /** Where the current decision applies. A highlight only -- nothing is hidden. */
  focused: TerrainSlot
  openTerrain: TerrainSlot | null
  onToggleFaces: (slot: TerrainSlot) => void
  selectMode: SelectMode | null
  selected: ReadonlySet<UnitId>
  onToggle: (id: UnitId) => void
  inspecting: UnitId | null
  onInspect: (id: UnitId | null) => void
  mySpecies: Species
  theirSpecies: Species
}) {
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  // Both sides: a sleeping enemy die is not selectable either way, but it should read
  // as asleep when you are looking at what you are about to attack.
  const asleep = sleepingIds(state)
  const art = useFaceArt()

  return (
    <div className="board">
      {TERRAIN_SLOTS.map((slot) => {
        const terrain = state.terrains[slot]
        const captured = terrain.face === 8
        const icon = captured
          ? null
          : (terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber) as GlyphName)
        const type = terrainType(terrainDie(terrain.dieId).type)
        const facesOpen = openTerrain === slot

        const selectableHere = selectableAt(selectMode, slot, 'mine')
        // New with the targeting SAIs, and the first decision that picks from the
        // army opposite: a Flame is chosen by the attacker, out of the defenders.
        const enemySelectableHere = selectableAt(selectMode, slot, 'theirs')

        return (
          <section
            key={slot}
            className={
              'terrain-card' +
              (slot === focused ? ' is-focused' : '') +
              (captured ? ' is-captured' : '')
            }
          >
            <button
              type="button"
              className="card-head-btn"
              onClick={() => onToggleFaces(slot)}
              aria-expanded={facesOpen}
              title="tap to see every face of this terrain die"
            >
              <span className="chip-head">
                <span className="chip-name">
                  {slotLabel(slot, human)}
                  {/*
                   * The eighth-face icon, not just the type. Since Phase 0a the
                   * Frontier is a second die of one species' own type, so a board
                   * can hold two Wastelands -- identical here unless the thing that
                   * differs is on screen. It is also what face 8 will do from
                   * Phase 5, which is worth reading before you turn a terrain up.
                   */}
                  <span className="chip-terrain">
                    {type.name}
                    <span className="chip-eighth">
                      {terrainDie(terrain.dieId).eighthFace.replace(/_/g, ' ')}
                    </span>
                  </span>
                  <ElementDots
                    elements={type.elements}
                    title={`${type.name} — ${type.elements.join(' + ')}`}
                  />
                </span>
                <span className="chip-face">{renderFace(art, terrain, icon)}</span>
              </span>
            </button>

            {captured && terrain.capturedBy !== null && (
              <p className="chip-held">
                held by {terrain.capturedBy === human ? 'you' : 'the enemy'}
              </p>
            )}

            {facesOpen && <TerrainDetail terrain={terrain} />}

            <ArmySide
              title="Enemy"
              species={theirSpecies}
              units={armyAt(state, enemy, slot)}
              selectable={enemySelectableHere}
              asleep={asleep}
              selected={selected}
              onToggle={onToggle}
              inspecting={inspecting}
              onInspect={onInspect}
            />
            <ArmySide
              title="Yours"
              species={mySpecies}
              units={armyAt(state, human, slot)}
              selectable={selectableHere}
              asleep={asleep}
              selected={selected}
              onToggle={onToggle}
              inspecting={inspecting}
              onInspect={onInspect}
            />
          </section>
        )
      })}
    </div>
  )
}
