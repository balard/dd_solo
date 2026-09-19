/**
 * One die face: SFR's art when we have it, our glyph when we do not.
 *
 * Both paths must look deliberate, because which one you get depends on whether
 * `tools/fetch_faces.py` has been run locally -- and a clone that never runs it is
 * a complete game, not a degraded one.
 */
import { dragonDie } from '../../data/load'
import type { DragonIcon, Face } from '../../data/types'
import { DRAGON_ICON_TEXT } from '../../engine/dragons'

import { FaceGlyph, Glyph, faceLabel } from './Glyph'
import { useFaceArt } from './useFaceArt'
import { useRuleSet } from './useRuleSet'

export function FaceArt({
  typeId,
  faceIndex,
  face,
  size = 40,
}: {
  typeId: string
  faceIndex: number
  face: Face
  size?: number
}) {
  const art = useFaceArt()
  const ruleSet = useRuleSet()
  const url = art.unitFace(typeId, faceIndex)
  const label = faceLabel(face, ruleSet)

  if (url === null) return <FaceGlyph face={face} size={Math.min(size, 22)} />

  return (
    <img
      className={`face-art i-${face.icon}`}
      src={url}
      width={size}
      height={size}
      alt={label}
      title={label}
      loading="lazy"
      draggable={false}
    />
  )
}

/**
 * One dragon face, art or glyph. `FaceArt`'s sibling rather than a branch inside
 * it: a dragon face is an icon with no count, so it shares neither `Face` nor
 * `faceLabel`, and folding the two together would mean a union at every call site
 * to say which kind of die this is.
 *
 * The art is keyed by *form* -- all five drakes print the same twelve images.
 */
export function DragonFaceArt({
  dieId,
  face,
  icon,
  size = 40,
  floor = 30,
}: {
  dieId: string
  /** 1-12, as printed. */
  face: number
  icon: DragonIcon
  size?: number
  /**
   * The size below which a glyph reads better than the art -- 30px, measured
   * (`OVERVIEW.md` §5). The board chip passes 0 to override it: at 16px this is a
   * *label* for which die is standing there rather than a face to read, and the
   * real Jaws mark is what identifies a dragon at a glance.
   */
  floor?: number
}) {
  const art = useFaceArt()
  const url = art.dragonFace(dragonDie(dieId).form, face)
  const label = `${icon.charAt(0)}${icon.slice(1).toLowerCase()} — ${DRAGON_ICON_TEXT[icon]}`

  if (url === null || size < floor) {
    return (
      <span className={`face-glyph i-${icon}`} title={label}>
        <Glyph name={icon} size={Math.min(size, 22)} />
      </span>
    )
  }

  // Its own class, because dragon art is **white line work** -- drawn for a dark
  // die -- where the unit art is black. Untinted it is white on a white panel:
  // invisible in light mode, and the blank boxes that gave it away. Flattened to
  // ink like the terrain art, and inverted in dark mode.
  return (
    <img
      className={`face-art dragon-face-art i-${icon}`}
      src={url}
      width={size}
      height={size}
      alt={label}
      title={label}
      loading="lazy"
      draggable={false}
    />
  )
}
