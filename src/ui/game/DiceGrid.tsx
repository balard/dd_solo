/**
 * An army as a grid of tappable dice.
 *
 * ~44px targets, because that is the smallest comfortable tap on a phone, and the
 * same grid doubles as the damage-assignment surface -- selecting units to lose is
 * the same gesture as looking at them.
 */
import { unitType } from '../../data/load'
import type { UnitId, UnitInstance } from '../../engine/types'

import { Glyph } from './Glyph'

const SIZE_LABEL: Record<string, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
  monster: '★',
}

export function DiceGrid({
  units,
  selectable = false,
  selected,
  onToggle,
}: {
  units: readonly UnitInstance[]
  selectable?: boolean
  selected?: ReadonlySet<UnitId>
  onToggle?: (id: UnitId) => void
}) {
  if (units.length === 0) return <p className="empty">no units here</p>

  return (
    <div className="dice-grid">
      {units.map((unit) => {
        const type = unitType(unit.typeId)
        const isSelected = selected?.has(unit.id) ?? false
        const Tag = selectable ? 'button' : 'div'
        return (
          <Tag
            key={unit.id}
            className={`die ${isSelected ? 'die-selected' : ''} ${selectable ? 'die-selectable' : ''}`}
            {...(selectable ? { onClick: () => onToggle?.(unit.id), type: 'button' as const } : {})}
            title={`${type.name} — ${type.health} health, ${type.dieType}`}
          >
            <span className="die-size">{SIZE_LABEL[type.size] ?? '?'}</span>
            <span className="die-name">{type.name}</span>
            <span className="die-health">{type.health}</span>
          </Tag>
        )
      })}
    </div>
  )
}

/** The dice of a roll, showing the face each one landed on. */
export function RollStrip({
  dice,
}: {
  dice: readonly { unitId: string; typeId: string; face: import('../../data/types').Face; results: number }[]
}) {
  return (
    <div className="roll-strip">
      {dice.map((die, i) => (
        <span
          key={`${die.unitId}-${i}`}
          className={`rolled i-${die.face.icon} ${die.results === 0 ? 'rolled-blank' : ''}`}
          title={`${unitType(die.typeId).name}: ${die.face.count} ${
            die.face.icon === 'SAI' ? die.face.sai : die.face.icon.toLowerCase()
          }`}
        >
          <Glyph name={die.face.icon} size={16} />
          {die.results > 0 && <b>{die.results}</b>}
        </span>
      ))}
    </div>
  )
}
