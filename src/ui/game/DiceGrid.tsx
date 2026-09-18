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
import type { Face, UnitClass, UnitType } from '../../data/types'
import type { RollEffectBody } from '../../engine/pipeline'
import type { UnitId, UnitInstance } from '../../engine/types'


import { ElementDots, speciesInfo } from './Elements'
import { FaceArt } from './FaceArt'
import { faceLabel } from './Glyph'
import { orderedForDisplay } from './prompts'
import { useFaceArt } from './useFaceArt'
import { useRuleSet } from './useRuleSet'

/**
 * The corner badge says what the die *does*, not how big it is.
 *
 * It used to read S/M/L/M+, which the health digit in the other corner already says
 * exactly (size determines health: 1/2/3/4) and the tile's own size says a third
 * time. Class is the one thing about a die that nothing else on the tile shows.
 *
 * **A monster has no class, and reads `MO`.** The data gives every monster one --
 * Strangle Vine is filed under missile, Gorgon under cavalry -- because each species
 * fields one monster per class line, but that is a fact about the *box*, not about
 * the die: Strangle Vine carries no missile face at all beyond its ID, so a `MI`
 * badge on it is a promise its faces do not keep. `classOf` is therefore the one
 * place either question is asked.
 */
const CLASS_BADGE: Record<string, string> = {
  heavy_melee: 'HM',
  light_melee: 'LM',
  cavalry: 'CA',
  missile: 'MI',
  magic: 'MA',
}

const MONSTER_BADGE = 'MO'
const MONSTER_LABEL = 'monster'

/** The class a die actually has, or null for a monster, which has none. */
function classOf(type: UnitType): UnitClass | null {
  return type.size === 'monster' ? null : type.unitClass
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
 * What a die is, in one line: "Oak Lord — large heavy melee", "Darktree — monster".
 *
 * No health: size *is* health in this data (small 1, medium 2, large 3, monster 4,
 * checked across all 40), so printing both says the same thing twice. The tile still
 * shows the number, where it earns its place doing arithmetic during damage.
 *
 * `size` doubles as the word for it, and `monster` is the interesting one -- it is a
 * size in the data but reads as a kind of die at the table, and it is the whole of
 * what a monster is: no class follows it.
 */
function describe(type: UnitType): string {
  const unitClass = classOf(type)
  if (unitClass === null) return `${type.name} — ${MONSTER_LABEL}`
  return `${type.name} — ${type.size} ${CLASS_LABEL[unitClass] ?? unitClass}`
}

const CLASS_LABEL: Record<string, string> = {
  heavy_melee: 'heavy melee',
  light_melee: 'light melee',
  cavalry: 'cavalry',
  missile: 'missile',
  magic: 'magic',
}

function badgeFor(type: UnitType): string {
  const unitClass = classOf(type)
  if (unitClass === null) return MONSTER_BADGE
  return CLASS_BADGE[unitClass] ?? '??'
}

/** The third item on the inspector's head line: a class, or "monster". */
function kindOf(type: UnitType): string {
  const unitClass = classOf(type)
  return unitClass === null ? MONSTER_LABEL : (CLASS_LABEL[unitClass] ?? unitClass)
}

/**
 * Every face of a die, so a player can see what it is able to do.
 *
 * Drawn large enough for the real art to actually read. At the 16-17px the roll
 * strip used to use, a multi-icon face packs its copies into ~7px each and an ID
 * portrait becomes a smudge; at 44px both are clear.
 */
function FaceSheet({ typeId, faces }: { typeId: string; faces: readonly Face[] }) {
  const ruleSet = useRuleSet()
  return (
    <div className="face-sheet">
      {faces.map((face, i) => (
        <span key={i} className={`sheet-face i-${face.icon}`} title={faceLabel(face, ruleSet)}>
          <FaceArt typeId={typeId} faceIndex={i} face={face} size={44} />
        </span>
      ))}
    </div>
  )
}

export function DiceGrid({
  units,
  selectable = false,
  asleep,
  selected,
  onToggle,
  inspecting,
  onInspect,
}: {
  units: readonly UnitInstance[]
  selectable?: boolean
  /** Dice that cannot be rolled or moved. They still show, still take damage and
   *  still inspect -- they are simply not pickable, and say so. */
  asleep?: ReadonlySet<UnitId>
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
        const isAsleep = asleep?.has(unit.id) ?? false
        const canSelect = selectable && !isAsleep
        const isSelected = selected?.has(unit.id) ?? false
        // A sleeping die is never pickable, so tapping it inspects even while the
        // rest of the army is being selected from.
        const isOpen = !canSelect && inspecting === unit.id
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
        const label = isAsleep ? `${describe(type)} — asleep` : describe(type)

        return (
          <div key={unit.id} className={`die-wrap ${isOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className={
                'die' +
                (isSelected ? ' die-selected' : '') +
                (canSelect ? ' die-selectable' : '') +
                (isAsleep ? ' die-asleep' : '') +
                (isOpen ? ' die-open' : '') +
                (squared ? ' die-squared' : '')
              }
              style={squared ? { width: tileSize, height: tileSize } : undefined}
              onClick={() =>
                canSelect ? onToggle?.(unit.id) : onInspect?.(isOpen ? null : unit.id)
              }
              // The portrait carries no name, so the tooltip and the accessible name
              // both have to. What a die *is* -- monster heavy melee, medium magic --
              // is what you want when weighing an attack, and it is the one thing the
              // tile cannot show; the tap affordance is guessable, so it gives way.
              title={label}
              aria-label={label}
            >
              <span className="die-kind">{badgeFor(type)}</span>
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
                    {type.health} health · {type.dieType} · {kindOf(type)}
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
  readonly effects?: readonly RollEffectBody[]
}

/**
 * What a die's effects did, in words.
 *
 * A die whose whole contribution is an effect generates **no results**, so the strip
 * used to grey it out and print nothing on it: a Fireshadow that Smote for 4 looked
 * exactly like a Fly that did nothing, beside a log line reporting damage from
 * nowhere. The face art already names the SAI; this says what it did.
 */
export function effectSummary(effects: readonly RollEffectBody[]): string | null {
  if (effects.length === 0) return null

  // **The return type is annotated on purpose.** Without it a missing arm yields
  // `undefined`, which `join` renders as nothing at all -- so every targeting SAI from
  // Phase 4b on drew "Flame — " with an empty half-sentence after the dash, and the
  // compiler had no opinion. Annotated, a new effect kind is a build error here.
  return effects
    .map((effect): string => {
      switch (effect.kind) {
        case 'unsavable':
          return `${effect.damage} damage, no save possible`
        case 'riposte':
          return `${effect.damage} damage straight back`
        case 'suppress_counter':
          return 'no counter-attack'
        case 'target_enemy':
          switch (effect.escape) {
            case 'none':
              return `${effect.health} health-worth ${effect.fate === 'bury' ? 'killed and buried' : 'killed'}`
            case 'save':
              return `${effect.health} health-worth must save or die`
            case 'maneuver':
              return `${effect.health} health-worth must maneuver or die`
            case 'id':
              return `${effect.health} health-worth seized — an ID goes to reserves`
          }
        // eslint-disable-next-line no-fallthrough -- every arm above returns
        case 'sleep':
          return 'one die asleep'
        case 'galeforce':
          return 'an opposing army at −4 save and maneuver'
        case 'choke':
          return `${effect.health} health-worth of the dice that rolled an ID`
        case 'confuse':
          return `${effect.health} health-worth rerolled`
        case 'wild_growth':
          return `${effect.budget} to split between saves and promotions`
        case 'free_move':
          return `may move itself and ${effect.health} health-worth`
      }
    })
    .join('; ')
}

const effectOf = (die: StripDie): string | null => effectSummary(die.effects ?? [])

/** The number to print on a die that generated an effect rather than results. */

function effectDamage(effects: readonly RollEffectBody[]): number | null {
  const total = effects.reduce((sum, e) => sum + ('damage' in e ? e.damage : 0), 0)
  return total > 0 ? total : null
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
  const ruleSet = useRuleSet()
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
                className={[
                  `rolled i-${die.face.icon}`,
                  // Blank only when the die really did nothing. An effect is not a
                  // result and never shows in `results`, so keying the grey-out on
                  // `results` alone hid Smite, Counter and Surprise completely.
                  die.results === 0 && effectOf(die) === null ? 'rolled-blank' : '',
                  effectOf(die) === null ? '' : 'rolled-effect',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  `${unitType(die.typeId).name}: ${faceLabel(die.face, ruleSet)}` +
                  (effectOf(die) === null ? '' : ` — ${effectOf(die)}`) +
                  (i > 0 ? ' (rerolled)' : '')
                }
              >
                <FaceArt typeId={die.typeId} faceIndex={die.faceIndex} face={die.face} size={30} />
                {die.results > 0 && <b>{die.results}</b>}
                {/* The effect's damage, marked apart from the result count beside it:
                    4 unsavable damage is not 4 melee results, and the two can appear
                    on the same die. */}
                {effectDamage(die.effects ?? []) !== null && (
                  <b className="effect-damage">+{effectDamage(die.effects ?? [])}</b>
                )}
              </span>

            </Fragment>
          ))}
        </span>
      ))}
    </div>
  )
}
