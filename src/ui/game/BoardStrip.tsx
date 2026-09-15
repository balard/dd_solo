/**
 * The three terrains as a compact always-visible strip.
 *
 * A full tabletop-style board does not fit on a phone, so the board is reduced to
 * what you need at a glance -- where each terrain stands and who is strong there --
 * and the actual playing happens in the focused terrain below.
 */
import { terrainDie, terrainFaceAction, terrainType, unitType } from '../../data/load'
import type { TerrainFaceNumber } from '../../data/types'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type PlayerId,
  type TerrainSlot,
} from '../../engine/types'

import { ElementDots } from './Elements'
import { Glyph, type GlyphName } from './Glyph'
import { slotLabel } from './prompts'
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
  return (
    <>
      {/* The number stays outside the art. It is the most important thing on the
          chip -- how close this terrain is to being captured -- and the digit drawn
          into the die is far too small to read at a glance. */}
      <span className="chip-number">{terrain.face}</span>
      {url !== null ? (
        <img className="chip-art" src={url} width={28} height={28} alt={label} title={label} />
      ) : (
        icon && <Glyph name={icon} size={15} />
      )}
    </>
  )
}

function strength(state: GameState, player: PlayerId, slot: TerrainSlot) {
  const units = armyAt(state, player, slot)
  return { dice: units.length, health: units.reduce((n, u) => n + unitType(u.typeId).health, 0) }
}

export function BoardStrip({
  state,
  human,
  focused,
  onFocus,
}: {
  state: GameState
  human: PlayerId
  focused: TerrainSlot
  onFocus: (slot: TerrainSlot) => void
}) {
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const art = useFaceArt()

  return (
    <div className="board-strip">
      {TERRAIN_SLOTS.map((slot) => {
        const terrain = state.terrains[slot]
        const captured = terrain.face === 8
        const icon = captured
          ? null
          : (terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber) as GlyphName)
        const mine = strength(state, human, slot)
        const theirs = strength(state, enemy, slot)

        return (
          <button
            key={slot}
            type="button"
            className={
              'terrain-chip' +
              (slot === focused ? ' is-focused' : '') +
              (captured ? ' is-captured' : '')
            }
            onClick={() => onFocus(slot)}
          >
            <span className="chip-head">
              <span className="chip-name">
                {slotLabel(slot, human)}
                <ElementDots
                  elements={terrainType(terrainDie(terrain.dieId).type).elements}
                  title={`${terrainType(terrainDie(terrain.dieId).type).name} — ${terrainType(
                    terrainDie(terrain.dieId).type,
                  ).elements.join(' + ')}`}
                />
              </span>
              <span className="chip-face">{renderFace(art, terrain, icon)}</span>
            </span>
            <span className="chip-armies">
              <span className="you">
                you {mine.dice}d {mine.health}h
              </span>
              <span className="them">
                foe {theirs.dice}d {theirs.health}h
              </span>
            </span>
            {captured && terrain.capturedBy !== null && (
              <span className="chip-held">
                held by {terrain.capturedBy === human ? 'you' : 'the enemy'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
