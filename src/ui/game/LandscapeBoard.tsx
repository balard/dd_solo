/**
 * The landscape board (v2 Phase 3d): a row per terrain, your army on the left, the
 * terrain die in the middle and the enemy on the right, so the two armies face each
 * other the way they do across a table. A fourth row holds the Reserve Armies.
 *
 * **It renders from exactly what `Board` renders from.** Selection is `selectableAt`
 * and `selectMode.only`, a tap is whatever `App` says it is, and nothing here knows a
 * rule. The two things it adds are presentation: identical dice stacked when a place
 * is crowded (`stacks.ts`), and who owns a terrain marked on the owner's side of its
 * die (`terrainTags`).
 *
 * Why these choices, measured rather than guessed, is `PLAN-V2.md`'s *What 3a found*.
 */
import { useLayoutEffect, useRef, useState } from 'react'

import { terrainDie, terrainFaceAction, terrainType, unitType } from '../../data/load'
import type { TerrainFaceNumber } from '../../data/types'
import { eighthFaceLabel } from '../../engine/effects'
import {
  TERRAIN_SLOTS,
  armyAt,
  dragonsAt,
  type GameState,
  type PlayerId,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../../engine/types'

import { DragonRow, EffectList, renderFace, type Species } from './Board'
import { DiceGrid } from './DiceGrid'
import { ElementDots } from './Elements'
import type { GlyphName } from './Glyph'
import { terrainTags, type TerrainTag } from './layout'
import {
  effectsOnArmy,
  effectsOnTerrain,
  selectableAt,
  sleepingIds,
  dieStatuses,
  slotLabel,
  type SelectMode,
} from './prompts'
import { densityFor, singledIds, type Density } from './stacks'
import { useFaceArt } from './useFaceArt'
import { useRuleSet } from './useRuleSet'

const health = (units: readonly UnitInstance[]) =>
  units.reduce((n, u) => n + unitType(u.typeId).health, 0)

/** What sits off the board for one side: counted on the reserve row, opened on a tap. */
export interface OffBoardCounts {
  readonly dua: number
  readonly bua: number
  readonly pool: number
}

export interface ReserveRow {
  readonly mine: readonly UnitInstance[]
  readonly theirs: readonly UnitInstance[]
  readonly mineSelectable: boolean
  readonly theirSelectable: boolean
  /** "still to place", mid-Reinforce. */
  readonly note: string | null
  readonly counts: { readonly mine: OffBoardCounts; readonly theirs: OffBoardCounts }
}

/**
 * The tag on one side of a terrain die: solid toward you, outlined toward the enemy.
 * An empty side still takes the tag's width, so the die stays centred in its column.
 */
function Tag({ tag, side }: { tag: TerrainTag | null; side: 'mine' | 'theirs' }) {
  return (
    <span className={`ls-tag is-${side}${tag === null ? ' is-none' : ''}`} aria-hidden={tag === null}>
      {tag ?? ''}
    </span>
  )
}

function OffBoardCount({
  counts,
  whose,
  open,
  onToggle,
}: {
  counts: OffBoardCounts
  whose: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="ls-count"
      onClick={onToggle}
      aria-expanded={open}
      title={`${whose}: ${counts.dua} dead, ${counts.bua} buried, ${counts.pool} dragons in the Summoning Pool — tap to see them`}
    >
      DUA <b>{counts.dua}</b> · BUA <b>{counts.bua}</b> · Pool <b>{counts.pool}</b>
    </button>
  )
}

export function LandscapeBoard({
  state,
  human,
  focused,
  onInspectTerrain,
  selectMode,
  selected,
  onToggle,
  inspecting,
  onInspect,
  mySpecies,
  theirSpecies,
  reserves,
  offBoardOpen,
  onToggleOffBoard,
  short,
}: {
  state: GameState
  human: PlayerId
  /** Where the current decision applies. A highlight only. */
  focused: TerrainSlot
  onInspectTerrain: (slot: TerrainSlot) => void
  selectMode: SelectMode | null
  selected: ReadonlySet<UnitId>
  onToggle: (id: UnitId) => void
  inspecting: UnitId | null
  onInspect: (id: UnitId | null) => void
  mySpecies: Species
  theirSpecies: Species
  reserves: ReserveRow
  offBoardOpen: boolean
  onToggleOffBoard: () => void
  /**
   * A phone held sideways (`isPhoneSideways`): a row of dice gets one line before it
   * steps down the ladder rather than two, and the terrain column drops to the die,
   * the slot and the health (3a finding 10).
   */
  short: boolean
}) {
  const lines = short ? 1 : 2
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const asleep = sleepingIds(state)
  const glare = dieStatuses(state)
  const singled = singledIds(state)
  const art = useFaceArt()
  const ruleSet = useRuleSet()
  const unrolled = state.rollOff !== undefined

  // Every side is one `1fr` column of the same grid, so one of them measures them all.
  const sideRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  useLayoutEffect(() => {
    const side = sideRef.current
    if (side === null) return
    setRoom(side.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setRoom(side.clientWidth))
    observer.observe(side)
    return () => observer.disconnect()
  }, [])

  const grid = (
    units: readonly UnitInstance[],
    density: Density,
    selectable: boolean,
  ) =>
    units.length === 0 ? null : (
      <DiceGrid
        units={units}
        selectable={selectable}
        asleep={asleep}
        glare={glare}
        singled={singled}
        selected={selected}
        onToggle={onToggle}
        inspecting={inspecting}
        onInspect={onInspect}
        only={selectMode?.only}
        compact={density.compact}
        stacked={density.stacked}
      />
    )

  const speciesLine = (species: Species) =>
    species.map((one) => (
      <span key={one.id}>
        {' '}
        {one.name}
        <ElementDots elements={one.elements} />
      </span>
    ))

  const reserveDensity = densityFor([reserves.mine, reserves.theirs], singled, room, lines)

  return (
    <div className={short ? 'ls-board is-short' : 'ls-board'}>
      <div className="ls-heads" aria-hidden="true">
        <span className="is-mine">Yours ·{speciesLine(mySpecies)}</span>
        <span />
        <span>Enemy ·{speciesLine(theirSpecies)}</span>
      </div>

      {TERRAIN_SLOTS.map((slot, index) => {
        const terrain = state.terrains[slot]
        const undecided = unrolled && slot === 'frontier'
        const held = terrain.face === 8
        const die = terrainDie(terrain.dieId)
        const type = terrainType(die.type)
        const icon = held
          ? null
          : (terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber) as GlyphName)
        const mine = armyAt(state, human, slot)
        const theirs = armyAt(state, enemy, slot)
        const density = densityFor([mine, theirs], singled, room, lines)
        const tags = terrainTags(slot, terrain.capturedBy, human)
        const label = slotLabel(slot, human)

        return (
          <section
            key={slot}
            className={'ls-row' + (slot === focused ? ' is-focused' : '') + (held ? ' is-captured' : '')}
            aria-label={label}
          >
            {/* A terrain effect sits on the place, on neither army: across the row. */}
            <div className="ls-place">
              <EffectList effects={effectsOnTerrain(state, slot, human)} place />
            </div>

            <div className="ls-side is-mine" ref={index === 0 ? sideRef : undefined}>
              <EffectList effects={effectsOnArmy(state, human, slot, human)} />
              {grid(mine, density, selectableAt(selectMode, slot, 'mine'))}
            </div>

            <div className="ls-mid">
              <span className="ls-slot">
                {label}
                {!undecided && <ElementDots elements={type.elements} title={`${type.name} — ${type.elements.join(' + ')}`} />}
              </span>
              <button
                type="button"
                className="ls-die"
                onClick={() => {
                  if (!undecided) onInspectTerrain(slot)
                }}
                title={
                  undecided
                    ? 'chosen after the roll-off'
                    : `${type.name}, eighth face ${die.eighthFace.replace(/_/g, ' ')} — tap to see every face`
                }
              >
                <Tag tag={tags.mine} side="mine" />
                <span className={'ls-face' + (held ? ' is-held' : '')}>
                  {undecided ? (
                    <span className="muted">?</span>
                  ) : unrolled ? (
                    // No face is rolled during the roll-off: a Home shows what its draw
                    // decided, its eighth face, as the cards do.
                    renderFace(art, { ...terrain, face: 8 }, null, ruleSet)
                  ) : (
                    renderFace(art, terrain, icon, ruleSet)
                  )}
                </span>
                <Tag tag={tags.theirs} side="theirs" />
              </button>
              {/* The type and the eighth face go to the inspector on a phone held
                  sideways (3a finding 10); CSS drops this line there. */}
              {!undecided && (
                <span className="ls-type">
                  {type.name}
                  <span className="chip-eighth" title={eighthFaceLabel(die.eighthFace, ruleSet)}>
                    {die.eighthFace.replace(/_/g, ' ')}
                  </span>
                </span>
              )}
              <span className="ls-str">
                {health(mine)}h <span className="muted">vs</span> {health(theirs)}h
              </span>
              <DragonRow dragons={dragonsAt(state, slot)} inspecting={inspecting} onInspect={onInspect} />
            </div>

            <div className="ls-side is-theirs">
              <EffectList effects={effectsOnArmy(state, enemy, slot, human)} />
              {grid(theirs, density, selectableAt(selectMode, slot, 'theirs'))}
            </div>
          </section>
        )
      })}

      {/* The fourth row (3a finding 8): a Reserve Army marches most turns, so it is laid
          out like a terrain. What is off the board entirely is a count at each outer
          edge, and opens below on a tap. */}
      <section className="ls-row is-reserve" aria-label="Reserves">
        <div className="ls-side is-mine">
          <div className="ls-resline">
            <OffBoardCount
              counts={reserves.counts.mine}
              whose="Yours"
              open={offBoardOpen}
              onToggle={onToggleOffBoard}
            />
            {grid(reserves.mine, reserveDensity, reserves.mineSelectable)}
          </div>
        </div>
        <div className="ls-mid">
          <span className="ls-slot">Reserves</span>
          <span className="ls-str">
            {health(reserves.mine)}h <span className="muted">vs</span> {health(reserves.theirs)}h
          </span>
          {reserves.note !== null && <span className="ls-note">{reserves.note}</span>}
        </div>
        <div className="ls-side is-theirs">
          <div className="ls-resline">
            {grid(reserves.theirs, reserveDensity, reserves.theirSelectable)}
            <OffBoardCount
              counts={reserves.counts.theirs}
              whose="The enemy's"
              open={offBoardOpen}
              onToggle={onToggleOffBoard}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
