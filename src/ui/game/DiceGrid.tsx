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
import { Fragment } from 'react'

import { unitType } from '../../data/load'
import type { Face, UnitType } from '../../data/types'
import type { UnitId, UnitInstance } from '../../engine/types'

import { ElementDots, speciesInfo } from './Elements'
import { FaceArt } from './FaceArt'
import { faceLabel } from './Glyph'
import { orderedForDisplay } from './prompts'
import { useFaceArt } from './useFaceArt'

/**
 * The corner badge says what the die *does*, not how big it is.
 *
 * It used to read S/M/L/M+, which the health digit in the other corner already says
 * exactly (size determines health: 1/2/3/4) and the tile's own size says a third
 * time. Class is the one thing about a die that nothing else on the tile shows.
 */
const CLASS_BADGE: Record<string, string> = {
  heavy_melee: 'HM',
  light_melee: 'LM',
  cavalry: 'CA',
  missile: 'MI',
  magic: 'MA',
}

/**
 * Tile and portrait size per die size, so a tile reads at a glance the way the
 * physical dice do -- a monster die really is the big one in the hand.
 *
 * The *whole tile* is square and scales, not just the art inside it; a big portrait
 * in a name-shaped box does not read as a bigger die. Size badge and health become
 * corner annotations so neither one drives the width.
 *
 * Two floors constrain this. The portrait floor is 30px: below roughly that, face
 * art is less legible than our own glyph (measured, see OVERVIEW section 5), so
 * `small` sits *at* the floor and the spread comes from raising the larger sizes.
 * The tile floor is 44px, the smallest comfortable tap on a phone.
 */
const TILE_SIZE: Record<string, number> = {
  small: 48,
  medium: 54,
  large: 60,
  monster: 70,
}

const PORTRAIT_SIZE: Record<string, number> = {
  small: 30,
  medium: 34,
  large: 38,
  monster: 46,
}

/**
 * What a die is, in one line: "Darktree — monster heavy melee".
 *
 * No health: size *is* health in this data (small 1, medium 2, large 3, monster 4,
 * checked across all 40), so printing both says the same thing twice. The tile still
 * shows the number, where it earns its place doing arithmetic during damage.
 *
 * `size` doubles as the word for it, and `monster` is the interesting one -- it is a
 * size in the data but reads as a kind of die at the table.
 */
function describe(type: UnitType): string {
  return `${type.name} — ${type.size} ${CLASS_LABEL[type.unitClass] ?? type.unitClass}`
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
  const art = useFaceArt()

  if (units.length === 0) return <p className="empty">no units here</p>

  return (
    <div className="dice-grid">
      {orderedForDisplay(units).map((unit) => {
        const type = unitType(unit.typeId)
        const isSelected = selected?.has(unit.id) ?? false
        const isOpen = !selectable && inspecting === unit.id
        const species = speciesInfo(type.species)

        // The ID face is the die's portrait -- it is the one face that is a picture
        // of the unit rather than of an action. It sits at index 0 on all 40 dice,
        // but ask the data rather than trusting that.
        const idIndex = type.faces.findIndex((face) => face.icon === 'ID')
        const portrait = idIndex < 0 ? null : art.unitFace(unit.typeId, idIndex)
        const portraitSize = PORTRAIT_SIZE[type.size] ?? 30
        // Square only while a portrait is (or may still be) what we draw. The
        // name fallback is wide text and keeps the original row-shaped tile.
        const squared = !art.ready || portrait !== null
        const tileSize = TILE_SIZE[type.size] ?? 48

        return (
          <div key={unit.id} className={`die-wrap ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className={
                'die' +
                (isSelected ? ' die-selected' : '') +
                (selectable ? ' die-selectable' : '') +
                (isOpen ? ' die-open' : '') +
                (squared ? ' die-squared' : '')
              }
              style={squared ? { width: tileSize, height: tileSize } : undefined}
              onClick={() =>
                selectable ? onToggle?.(unit.id) : onInspect?.(isOpen ? null : unit.id)
              }
              // The portrait carries no name, so the tooltip and the accessible name
              // both have to. What a die *is* -- monster heavy melee, medium magic --
              // is what you want when weighing an attack, and it is the one thing the
              // tile cannot show; the tap affordance is guessable, so it gives way.
              title={describe(type)}
              aria-label={describe(type)}
            >
              <span className="die-kind">{CLASS_BADGE[type.unitClass] ?? '??'}</span>
              {/*
               * The portrait replaces the name only when we actually have the art.
               * Without it every ID face would draw the same generic glyph and the
               * tiles would become indistinguishable, so a clone that never ran
               * `npm run art` keeps the names it has always had.
               */}
              {!art.ready ? (
                <span
                  className="die-portrait-slot"
                  style={{ width: portraitSize, height: portraitSize }}
                />
              ) : portrait !== null ? (
                <img
                  className="die-portrait"
                  src={portrait}
                  width={portraitSize}
                  height={portraitSize}
                  alt={type.name}
                  draggable={false}
                />
              ) : (
                <span className="die-name">{type.name}</span>
              )}
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

/** The shape `RollStrip` needs of a `DieRoll`, kept structural so the log can pass
 *  its own entries without importing the engine's type. */
export interface StripDie {
  readonly unitId: string
  readonly typeId: string
  readonly faceIndex: number
  readonly face: Face
  readonly results: number
  readonly reroll?: true
}

/**
 * Puts each reroll beside the die that caused it.
 *
 * The engine appends rerolls at the end of the roll, because that is genuinely the
 * order the dice were thrown and the order the RNG was consumed -- steps 1 then 3 of
 * the pipeline. Read left to right that leaves a Rend at the front of the strip and
 * its second face somewhere near the back, connected by nothing. So the strip groups
 * them: same unit, in roll order, drawn as a chain.
 *
 * Grouping only, never reordering within a chain -- the arrow means "and then this",
 * so the sequence has to be the real one.
 */
export function chainRerolls(dice: readonly StripDie[]): readonly (readonly StripDie[])[] {
  const chains: StripDie[][] = []
  const byUnit = new Map<string, StripDie[]>()

  for (const die of dice) {
    const existing = byUnit.get(die.unitId)
    if (die.reroll === true && existing !== undefined) {
      existing.push(die)
      continue
    }
    const chain = [die]
    chains.push(chain)
    byUnit.set(die.unitId, chain)
  }
  return chains
}

/** The dice of a roll, showing the face each one landed on. */
export function RollStrip({ dice }: { dice: readonly StripDie[] }) {
  return (
    <div className="roll-strip">
      {chainRerolls(dice).map((chain, c) => (
        <span className={`roll-chain ${chain.length > 1 ? 'is-rerolled' : ''}`} key={c}>
          {chain.map((die, i) => (
            <Fragment key={`${die.unitId}-${i}`}>
              {/* An arrow, not a gap: a rerolled die is one die that was thrown
                  twice, and both faces count. Two dice sitting next to each other
                  would read as two units. */}
              {i > 0 && (
                <span className="reroll-arrow" aria-hidden="true">
                  &rarr;
                </span>
              )}
              <span
                className={`rolled i-${die.face.icon} ${die.results === 0 ? 'rolled-blank' : ''}`}
                title={
                  `${unitType(die.typeId).name}: ${faceLabel(die.face)}` +
                  (i > 0 ? ' (rerolled)' : '')
                }
              >
                <FaceArt typeId={die.typeId} faceIndex={die.faceIndex} face={die.face} size={30} />
                {die.results > 0 && <b>{die.results}</b>}
              </span>
            </Fragment>
          ))}
        </span>
      ))}
    </div>
  )
}
