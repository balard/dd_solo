/**
 * One die face: SFR's art when we have it, our glyph when we do not.
 *
 * Both paths must look deliberate, because which one you get depends on whether
 * `tools/fetch_faces.py` has been run locally -- and a clone that never runs it is
 * a complete game, not a degraded one.
 */
import type { Face } from '../../data/types'

import { FaceGlyph, faceLabel } from './Glyph'
import { useFaceArt } from './useFaceArt'

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
  const url = art.unitFace(typeId, faceIndex)
  const label = faceLabel(face)

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
