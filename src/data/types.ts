/**
 * Types for the starter-set die data.
 *
 * These describe die *definitions* -- the content in `data/starter/`. Runtime game
 * state (units in armies, terrains in play) belongs to the engine and is not here.
 */

export type Element = 'air' | 'water' | 'earth' | 'fire' | 'death' | 'ivory'

/** The five result types an army can roll for. */
export type ResultType = 'melee' | 'missile' | 'magic' | 'save' | 'maneuver'

/** Icons that appear on a unit die face. */
export type NormalIcon = 'ID' | 'MELEE' | 'MISSILE' | 'MAGIC' | 'SAVE' | 'MANEUVER'

/**
 * One face of a unit die.
 *
 * `count` is how many icons are printed on the face, and it is already the final
 * answer in every case: an ID face's count equals the unit's health, and a monster's
 * normal faces all read 4. So nothing downstream needs to special-case ID or size.
 *
 * For most SAIs `count` is a result count, but for targeting SAIs it is the SAI's X
 * parameter -- `2 SAI:Flame` targets two health-worth of units. Each SAI interprets
 * its own number. SAIs generate nothing in v0.
 */
export type Face =
  | { readonly count: number; readonly icon: NormalIcon }
  | { readonly count: number; readonly icon: 'SAI'; readonly sai: string }

export type UnitClass = 'heavy_melee' | 'light_melee' | 'cavalry' | 'missile' | 'magic'
export type UnitSize = 'small' | 'medium' | 'large' | 'monster'

export interface UnitType {
  readonly id: string
  readonly name: string
  readonly species: string
  readonly unitClass: UnitClass
  readonly size: UnitSize
  readonly health: number
  readonly dieType: 'd6' | 'd10'
  readonly faces: readonly Face[]
}

export interface Species {
  readonly id: string
  readonly name: string
  readonly elements: readonly Element[]
}

/** The action a terrain face permits. Faces 1-7 only; face 8 is the eighth face. */
export type ActionIcon = 'MELEE' | 'MISSILE' | 'MAGIC'

/** Numbered faces of a terrain die that carry an action. */
export type TerrainFaceNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type EighthFaceIcon = 'city' | 'standing_stones' | 'temple' | 'tower'

/**
 * A terrain *type* fixes faces 1-7. A terrain *die* is a type plus an eighth-face
 * icon, so the four variants of a type share these faces exactly.
 */
export interface TerrainType {
  readonly id: string
  readonly name: string
  readonly elements: readonly Element[]
  readonly faces: Readonly<Record<TerrainFaceNumber, ActionIcon>>
}

export interface TerrainDie {
  readonly id: string
  readonly type: string
  readonly eighthFace: EighthFaceIcon
}

/** Thrown when the data files contain something the loader cannot make sense of. */
export class DataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DataError'
  }
}
