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
import {
  dragonDie,
  dragonFaceIcon,
  dragonName,
  terrainDie,
  terrainFaceAction,
  terrainType,
  unitType,
} from '../../data/load'
import type { DragonFaceNumber, DragonIcon, TerrainFaceNumber } from '../../data/types'
import {
  BREATH_NAME,
  BREATH_TEXT,
  DRAGON_AUTOMATIC_SAVES,
  DRAGON_HEALTH,
  DRAGON_ICON_TEXT,
} from '../../engine/dragons'
import { eighthFaceLabel } from '../../engine/effects'
import {
  TERRAIN_SLOTS,
  armyAt,
  dragonsAt,
  type DragonInPlay,
  type GameState,
  type PlayerId,
  type TerrainInPlay,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../../engine/types'

import { DiceGrid } from './DiceGrid'
import { DragonFaceArt } from './FaceArt'
import { ElementDots, speciesInfo } from './Elements'
import { Glyph, type GlyphName } from './Glyph'
import {
  effectChips,
  effectsOnArmy,
  effectsOnTerrain,
  selectableAt,
  sleepingIds,
  dieStatuses,
  type DieStatus,
  slotLabel,
  type ArmyEffect,
  type SelectMode,
} from './prompts'
import { useFaceArt } from './useFaceArt'
import { useRuleSet } from './useRuleSet'

/**
 * The terrain die face.
 *
 * The real art has the number drawn into it, so when it is available it replaces
 * both the number and the glyph -- it *is* the die face. Without it, the number
 * plus our glyph says the same thing.
 */
export function renderFace(
  art: ReturnType<typeof useFaceArt>,
  terrain: GameState['terrains'][TerrainSlot],
  icon: GlyphName | null,
  ruleSet: ReturnType<typeof useRuleSet>,
) {
  const die = terrainDie(terrain.dieId)

  if (terrain.face === 8) {
    const url = art.eighthFace(die.eighthFace)
    const label = die.eighthFace.replace('_', ' ')
    const title = eighthFaceLabel(die.eighthFace, ruleSet)
    return url !== null ? (
      <img className="chip-art" src={url} width={30} height={30} alt={label} title={title} />
    ) : (
      <span className="chip-eighth" title={title}>
        {label}
      </span>
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
export function TerrainDetail({
  terrain,
}: {
  /** A die, and the face it shows when it is in play. The army builder (v2 Phase 4)
   *  shows a die that is on no board yet, so it has no face to mark. */
  terrain: Pick<TerrainInPlay, 'dieId'> & { readonly face?: TerrainInPlay['face'] }
}) {
  const art = useFaceArt()
  const ruleSet = useRuleSet()
  const die = terrainDie(terrain.dieId)
  const type = terrainType(die.type)
  const eighthLabel = die.eighthFace.replace(/_/g, ' ')
  const eighthUrl = art.eighthFace(die.eighthFace)
  const eighthTitle = eighthFaceLabel(die.eighthFace, ruleSet)

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
          title={`face 8 — ${eighthTitle}`}
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

/**
 * The dragons at a terrain, or in a Summoning Pool.
 *
 * Its own row between the terrain head and the two armies, because a dragon belongs
 * to neither: it attacks the marching player's army whoever brought it, its own
 * summoner included. Rendering it inside an `ArmySide` would say the opposite.
 *
 * **A dragon is a die like the units, so it draws as one** (v2 Phase 3b): a square
 * tile, since every unit is a square -- a d12 outline is the plan for the day units are
 * not. It used to be a pill with "(yours)" or "(enemy)" in it. The pill was too small to
 * read at a glance, and the owner is the one fact about a dragon that changes nothing in
 * play, so it moved to the inspector. What stays on the tile is what decides a fight:
 * the element (the tint, and the band), and whether it is a drake or a wyrm.
 */
export function DragonRow({
  dragons,
  inspecting,
  onInspect,
  inPool = false,
}: {
  dragons: readonly DragonInPlay[]
  inspecting: string | null
  onInspect: (id: string | null) => void
  /** A Summoning Pool rather than a terrain (Phase 9e): it attacks nobody from there. */
  inPool?: boolean
}) {
  if (dragons.length === 0) return null
  return (
    <div className="dragon-row">
      {dragons.map((dragon) => {
        const die = dragonDie(dragon.dieId)
        const isOpen = inspecting === dragon.id
        const label = `${dragonName(dragon.dieId)}${
          inPool ? ', waiting to be summoned' : ', and it attacks whoever is marching'
        }`
        return (
          <button
            key={dragon.id}
            type="button"
            // `dragon-el-`, not `el-`: `.el-<element>` is the element *dot*, and it
            // paints a background.
            className={`dragon-tile dragon-el-${die.element} ${isOpen ? 'is-open' : ''}`}
            onClick={() => onInspect(isOpen ? null : dragon.id)}
            title={`${label} — tap to see every face`}
            aria-label={label}
            aria-expanded={isOpen}
          >
            <DragonTileBody dieId={dragon.dieId} />
          </button>
        )
      })}
    </div>
  )
}

/** What is drawn inside a dragon tile: the form, its Jaws face, the element band. The
 *  button around it is the caller's -- a board inspects, the army builder picks. */
export function DragonTileBody({ dieId }: { dieId: string }) {
  const die = dragonDie(dieId)
  return (
    <>
      <span className="dragon-form">{die.form === 'wyrm' ? 'WY' : 'DR'}</span>
      {/* Its Jaws face stands for the die, the way an ID face stands for a unit.
          Falls back to our glyph with no art fetched. */}
      <DragonFaceArt dieId={dieId} face={jawsFace(dieId)} icon="JAWS" size={30} />
      <span className="dragon-band" aria-hidden="true" />
    </>
  )
}

/** Every face of a dragon die and what kills it, for the floating inspector (9e). */
export function DragonDetail({
  dieId,
  whose,
}: {
  dieId: string
  /** "yours" or "the enemy's" in play; null in the army builder, where it is nobody's yet. */
  whose: string | null
}) {
  const die = dragonDie(dieId)
  return (
    <>
      <p className="detail-head">
        <b>{dragonName(dieId)}</b>
        <span className="muted">
          {whose !== null && `${whose} · `}
          {DRAGON_HEALTH} health ·{' '}
          {DRAGON_AUTOMATIC_SAVES} automatic saves · d12
        </span>
        <ElementDots elements={[die.element]} />
      </p>
      <p className="sai-text">
        Ten of one type kills it — melee <em>or</em> missile, never both. Five if it rolls its
        belly. Its breath is <b>{BREATH_NAME[die.element]}</b>: {BREATH_TEXT[die.element]}
      </p>
      <DragonFaceSheet dieId={dieId} />
    </>
  )
}

/**
 * All twelve faces of a dragon die, with the repeats counted rather than listed --
 * four claws all do the same thing, and drawing them four times says nothing.
 *
 * At 44px, the same size the unit inspector and the terrain sheet use: this is one
 * of the two places a dragon face is big enough for the real art to beat a glyph.
 */
function DragonFaceSheet({ dieId }: { dieId: string }) {
  const counts = new Map<DragonIcon, { face: DragonFaceNumber; count: number }>()
  for (const n of FACE_NUMBERS) {
    const icon = dragonFaceIcon(dieId, n)
    const seen = counts.get(icon)
    // The first face showing this icon is the one whose art we draw.
    counts.set(icon, { face: seen?.face ?? n, count: (seen?.count ?? 0) + 1 })
  }

  return (
    <ul className="dragon-faces">
      {[...counts].map(([icon, { face, count }]) => (
        <li key={icon}>
          <DragonFaceArt dieId={dieId} face={face} icon={icon} size={30} />
          <b>
            {icon.charAt(0) + icon.slice(1).toLowerCase()}
            {count > 1 && <span className="muted"> ×{count}</span>}
          </b>
          <span className="muted">{DRAGON_ICON_TEXT[icon]}</span>
        </li>
      ))}
    </ul>
  )
}

const FACE_NUMBERS: readonly DragonFaceNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** Which face carries Jaws. Asked of the data rather than assumed to be face 1. */
function jawsFace(dieId: string): DragonFaceNumber {
  const found = FACE_NUMBERS.find((n) => dragonFaceIcon(dieId, n) === 'JAWS')
  if (found === undefined) throw new Error(`${dieId} has no Jaws face`)
  return found
}

/** The species a force holds -- one, or several for a mixed force (v2 Phase 1). */
export type Species = readonly NonNullable<ReturnType<typeof speciesInfo>>[]

/**
 * Effects with a duration, as chips: the source and what it does, counted when the
 * same one sits there twice, with when it ends on hover (v2 Phase 3b). Shared by an
 * army's heading, a terrain and the DUA in the Fallen section, so an effect reads the
 * same wherever it sits. `place` marks a terrain's, which belongs to neither army.
 */
export function EffectList({
  effects,
  place = false,
}: {
  effects: readonly ArmyEffect[]
  place?: boolean
}) {
  if (effects.length === 0) return null
  return (
    <ul className={place ? 'effect-chips is-place' : 'effect-chips'}>
      {effectChips(effects).map((chip) => (
        <li
          key={`${chip.source}|${chip.what}|${chip.until}`}
          className="effect-chip"
          title={`${chip.source}${chip.count > 1 ? ` ×${chip.count}` : ''}: ${chip.what} — until ${chip.until}`}
        >
          <b>
            {chip.source}
            {chip.count > 1 && <> &times;{chip.count}</>}
          </b>
          {chip.what !== '' && <> {chip.what}</>}
        </li>
      ))}
    </ul>
  )
}

function ArmySide({
  title,
  species,
  units,
  effects,
  selectable,
  asleep,
  glare,
  selected,
  onToggle,
  inspecting,
  onInspect,
  only,
}: {
  title: string
  species: Species
  units: readonly UnitInstance[]
  /** What is sitting on this army until somebody's next turn. */
  effects: readonly ArmyEffect[]
  selectable: boolean
  asleep: ReadonlySet<UnitId>
  glare: ReadonlyMap<UnitId, DieStatus>
  selected: ReadonlySet<UnitId>
  onToggle: (id: UnitId) => void
  inspecting: UnitId | null
  onInspect: (id: UnitId | null) => void
  only?: ReadonlySet<UnitId> | undefined
}) {
  const { dice, health } = strength(units)
  return (
    <section className="army card-army">
      <h3>
        {title}
        {species.map((one) => (
          <span key={one.id}>
            {' '}
            <span className="muted">{one.name}</span>
            <ElementDots elements={one.elements} />
          </span>
        ))}{' '}
        <span className="muted">
          {dice}d / {health}h
        </span>
      </h3>
      {/*
       * An effect with a duration is the only thing on this board that is true
       * between rolls, and it used to be invisible: a Galeforced army saved at minus
       * four with nothing on screen to say so, because the only mention of it was a
       * log line that had already scrolled away.
       */}
      <EffectList effects={effects} />
      <DiceGrid
        units={units}
        selectable={selectable}
        asleep={asleep}
        glare={glare}
        selected={selected}
        onToggle={onToggle}
        inspecting={inspecting}
        onInspect={onInspect}
        only={only}
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
  const glare = dieStatuses(state)
  const art = useFaceArt()
  const ruleSet = useRuleSet()

  // The roll-off choice is open (v1 Phase 10e): no starting face is rolled yet, and the
  // Frontier slot holds a placeholder -- p1's proposal -- that the choice may replace.
  // Drawing either would show the player a board nobody has rolled.
  const unrolled = state.rollOff !== undefined

  return (
    <div className="board">
      {TERRAIN_SLOTS.map((slot) => {
        const terrain = state.terrains[slot]
        const undecided = unrolled && slot === 'frontier'
        const captured = terrain.face === 8
        const icon = captured
          ? null
          : (terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber) as GlyphName)
        const type = terrainType(terrainDie(terrain.dieId).type)
        const facesOpen = openTerrain === slot
        const terrainEffects = effectsOnTerrain(state, slot, human)

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
            data-slot={slot}
          >
            <button
              type="button"
              className="card-head-btn"
              onClick={() => {
                if (!undecided) onToggleFaces(slot)
              }}
              aria-expanded={facesOpen}
              title={undecided ? 'chosen after the roll-off' : 'tap to see every face of this terrain die'}
            >
              <span className="chip-head">
                <span className="chip-name">
                  {slotLabel(slot, human)}
                  {/*
                   * The eighth-face icon, not just the type. Phase 5b draws both
                   * Home Terrains independently of species, so a board can hold two
                   * of the same type -- identical here unless the thing that
                   * differs is on screen. The icon is what face 8 does once
                   * captured, hence the tooltip from `eighthFaceLabel`.
                   */}
                  {undecided ? (
                    <span className="chip-terrain muted">chosen after the roll-off</span>
                  ) : (
                    <>
                      <span className="chip-terrain">
                        {type.name}
                        <span
                          className="chip-eighth"
                          title={eighthFaceLabel(terrainDie(terrain.dieId).eighthFace, ruleSet)}
                        >
                          {terrainDie(terrain.dieId).eighthFace.replace(/_/g, ' ')}
                        </span>
                      </span>
                      <ElementDots
                        elements={type.elements}
                        title={`${type.name} — ${type.elements.join(' + ')}`}
                      />
                    </>
                  )}
                </span>
                {/* During the roll-off no face is rolled, so a Home shows what it can
                    become instead: its eighth face, the one thing its draw decided. The
                    Frontier shows nothing -- its die is not chosen yet. */}
                <span className="chip-face">
                  {unrolled
                    ? !undecided && renderFace(art, { ...terrain, face: 8 }, null, ruleSet)
                    : renderFace(art, terrain, icon, ruleSet)}
                </span>
              </span>
            </button>

            {captured && terrain.capturedBy !== null && (
              <p className="chip-held">
                held by {terrain.capturedBy === human ? 'you' : 'the enemy'}
              </p>
            )}


            {/* A terrain effect sits on the *place*, not on either army: Ash Storm
                subtracts from both sides' rolls here and Wall of Fog wards the place
                against missile fire from anywhere. Drawing it inside an `ArmySide`
                would say it belonged to that army, which is the opposite of the rule. */}
            <EffectList effects={terrainEffects} place />

            <DragonRow
              dragons={dragonsAt(state, slot)}
              inspecting={inspecting}
              onInspect={onInspect}
            />
            <ArmySide
              title="Enemy"
              species={theirSpecies}
              units={armyAt(state, enemy, slot)}
              effects={effectsOnArmy(state, enemy, slot, human)}
              selectable={enemySelectableHere}
              asleep={asleep}
              glare={glare}
              selected={selected}
              onToggle={onToggle}
              inspecting={inspecting}
              onInspect={onInspect}
              only={selectMode?.only}
            />
            <ArmySide
              title="Yours"
              species={mySpecies}
              units={armyAt(state, human, slot)}
              effects={effectsOnArmy(state, human, slot, human)}
              selectable={selectableHere}
              asleep={asleep}
              glare={glare}
              selected={selected}
              onToggle={onToggle}
              inspecting={inspecting}
              onInspect={onInspect}
              only={selectMode?.only}
            />
          </section>
        )
      })}
    </div>
  )
}
