/**
 * The three terrains as a compact always-visible strip.
 *
 * A full tabletop-style board does not fit on a phone, so the board is reduced to
 * what you need at a glance -- where each terrain stands and who is strong there --
 * and the actual playing happens in the focused terrain below.
 */
import { terrainDie, terrainFaceAction, unitType } from '../../data/load'
import type { TerrainFaceNumber } from '../../data/types'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type PlayerId,
  type TerrainSlot,
} from '../../engine/types'

import { Glyph, type GlyphName } from './Glyph'
import { slotLabel } from './prompts'

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
              <span className="chip-name">{slotLabel(slot, human)}</span>
              <span className="chip-face">
                {captured ? (
                  <span className="chip-eighth">
                    {terrainDie(terrain.dieId).eighthFace.replace('_', ' ')}
                  </span>
                ) : (
                  <>
                    <span className="chip-number">{terrain.face}</span>
                    {icon && <Glyph name={icon} size={15} />}
                  </>
                )}
              </span>
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
