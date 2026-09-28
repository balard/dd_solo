/**
 * The floating die inspector (v1 Phase 9e): every face of a unit, a dragon or a
 * terrain, over the board rather than inside it.
 *
 * It replaced three inline panels -- one under a unit tile, one under a dragon chip, one
 * under a terrain heading -- that each pushed the rest of the page down and sideways,
 * and that each had its own open/closed state: opening a unit left a terrain open. One
 * target, one panel, and opening anything replaces whatever was open.
 *
 * A backdrop rather than an anchored popover: on a phone an anchored box has nowhere to
 * go but over the thing it is anchored to. Esc or a tap outside closes it.
 */
import { useEffect } from 'react'

import type { GameState, PlayerId, TerrainSlot, UnitId } from '../../engine/types'

import { DragonDetail, TerrainDetail } from './Board'
import { UnitDetail } from './DiceGrid'

export type InspectTarget =
  | { readonly kind: 'unit'; readonly id: UnitId }
  | { readonly kind: 'dragon'; readonly id: string }
  | { readonly kind: 'terrain'; readonly slot: TerrainSlot }

export function Inspector({
  target,
  state,
  human,
  onClose,
}: {
  target: InspectTarget
  state: GameState
  /** Whose dragon it is reads "yours" or "the enemy's" (v2 Phase 3b): the board stopped
   *  saying, so the inspector is where it is asked. */
  human: PlayerId
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const body = (() => {
    switch (target.kind) {
      case 'unit': {
        const unit = state.units[target.id]
        return unit === undefined ? null : <UnitDetail typeId={unit.typeId} />
      }
      case 'dragon': {
        const dragon = state.dragons[target.id]
        return dragon === undefined ? null : <DragonDetail dragon={dragon} human={human} />
      }
      case 'terrain':
        return <TerrainDetail terrain={state.terrains[target.slot]} />
    }
  })()
  if (body === null) return null

  return (
    <div className="inspector-backdrop" onClick={onClose}>
      <div
        className="inspector"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="inspector-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        {body}
      </div>
    </div>
  )
}
