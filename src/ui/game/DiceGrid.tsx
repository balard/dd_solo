/**
 * An army as a grid of tappable dice.
 *
 * ~44px targets, because that is the smallest comfortable tap on a phone.
 *
 * A tile does two jobs depending on what the game is asking. When a decision needs
 * units chosen -- damage, retreat, reinforce -- tapping selects. Otherwise tapping
 * *inspects*: the tile opens to show every face the die has. That matters because
 * until now the app only ever showed outcomes. You could watch an Oak Lord roll,
 * but never find out what it was capable of rolling, which is exactly what you need
 * to decide whether to attack with it.
 */
import { unitType } from '../../data/load'
import type { Face } from '../../data/types'
import type { UnitId, UnitInstance } from '../../engine/types'

import { ElementDots, speciesInfo } from './Elements'
import { FaceArt } from './FaceArt'
import { faceLabel } from './Glyph'

const SIZE_LABEL: Record<string, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
  monster: 'M+',
}

const CLASS_LABEL: Record<string, string> = {
  heavy_melee: 'heavy melee',
  light_melee: 'light melee',
  cavalry: 'cavalry',
  missile: 'missile',
  magic: 'magic',
}

/**
 * Every face of a die, so a player can see what it is able to do.
 *
 * Drawn large enough for the real art to actually read. At the 16-17px the roll
 * strip used to use, a multi-icon face packs its copies into ~7px each and an ID
 * portrait becomes a smudge; at 44px both are clear.
 */
function FaceSheet({ typeId, faces }: { typeId: string; faces: readonly Face[] }) {
  return (
    <div className="face-sheet">
      {faces.map((face, i) => (
        <span key={i} className={`sheet-face i-${face.icon}`} title={faceLabel(face)}>
          <FaceArt typeId={typeId} faceIndex={i} face={face} size={44} />
        </span>
      ))}
    </div>
  )
}

export function DiceGrid({
  units,
  selectable = false,
  selected,
  onToggle,
  inspecting,
  onInspect,
}: {
  units: readonly UnitInstance[]
  selectable?: boolean
  selected?: ReadonlySet<UnitId>
  onToggle?: (id: UnitId) => void
  inspecting?: UnitId | null
  onInspect?: (id: UnitId | null) => void
}) {
  if (units.length === 0) return <p className="empty">no units here</p>

  return (
    <div className="dice-grid">
      {units.map((unit) => {
        const type = unitType(unit.typeId)
        const isSelected = selected?.has(unit.id) ?? false
        const isOpen = !selectable && inspecting === unit.id
        const species = speciesInfo(type.species)

        return (
          <div key={unit.id} className={`die-wrap ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className={
                'die' +
                (isSelected ? ' die-selected' : '') +
                (selectable ? ' die-selectable' : '') +
                (isOpen ? ' die-open' : '') +
                (type.size === 'monster' ? ' die-monster' : '')
              }
              onClick={() =>
                selectable ? onToggle?.(unit.id) : onInspect?.(isOpen ? null : unit.id)
              }
              title={
                selectable
                  ? `${type.name} — ${type.health} health`
                  : `${type.name} — tap to see its faces`
              }
            >
              <span className="die-size">{SIZE_LABEL[type.size] ?? '?'}</span>
              <span className="die-name">{type.name}</span>
              <span className="die-health">{type.health}</span>
            </button>

            {isOpen && (
              <div className="die-detail">
                <p className="detail-head">
                  <b>{type.name}</b>
                  <span className="muted">
                    {type.health} health · {type.dieType} · {CLASS_LABEL[type.unitClass]}
                  </span>
                  {species && <ElementDots elements={species.elements} />}
                </p>
                <FaceSheet typeId={unit.typeId} faces={type.faces} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The dice of a roll, showing the face each one landed on. */
export function RollStrip({
  dice,
}: {
  dice: readonly {
    unitId: string
    typeId: string
    faceIndex: number
    face: Face
    results: number
  }[]
}) {
  return (
    <div className="roll-strip">
      {dice.map((die, i) => (
        <span
          key={`${die.unitId}-${i}`}
          className={`rolled i-${die.face.icon} ${die.results === 0 ? 'rolled-blank' : ''}`}
          title={`${unitType(die.typeId).name}: ${faceLabel(die.face)}`}
        >
          <FaceArt typeId={die.typeId} faceIndex={die.faceIndex} face={die.face} size={30} />
          {die.results > 0 && <b>{die.results}</b>}
        </span>
      ))}
    </div>
  )
}
