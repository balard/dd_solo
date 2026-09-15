/**
 * The real dice faces, when they are available.
 *
 * `tools/fetch_faces.py` mirrors SFR's face art into `public/faces/` and writes a
 * manifest keyed by unit type and face index. That directory is gitignored, so a
 * fresh clone has none of it -- and must still be a complete game. Everything here
 * therefore degrades to our own glyphs rather than failing: a missing manifest, a
 * missing key and a failed fetch all just mean "draw the glyph".
 *
 * The manifest exists because the remote asset set is sparse and not derivable from
 * (icon, count) -- resolving it means trying candidates and seeing which answer,
 * which the fetch script can do and a browser cannot do synchronously.
 */
import { useEffect, useState } from 'react'

interface Manifest {
  readonly version: number
  readonly units: Readonly<Record<string, string>>
  readonly terrains: Readonly<Record<string, string>>
}

const base = import.meta.env.BASE_URL

/** Fetched at most once per page, whatever how many components ask. */
let pending: Promise<Manifest | null> | null = null

function loadManifest(): Promise<Manifest | null> {
  pending ??= fetch(`${base}faces/manifest.json`)
    .then((response) => (response.ok ? (response.json() as Promise<Manifest>) : null))
    .catch(() => null)
  return pending
}

export interface FaceArtLookup {
  /** Art for one face of one unit die, or null to fall back to a glyph. */
  readonly unitFace: (typeId: string, faceIndex: number) => string | null
  /** Art for a numbered terrain face, which has its number drawn into it. */
  readonly terrainFace: (terrainTypeId: string, face: number) => string | null
  readonly eighthFace: (icon: string) => string | null
  /** False until the manifest has been fetched, so callers can avoid a flash. */
  readonly ready: boolean
}

const NONE: FaceArtLookup = {
  unitFace: () => null,
  terrainFace: () => null,
  eighthFace: () => null,
  ready: false,
}

export function useFaceArt(): FaceArtLookup {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void loadManifest().then((loaded) => {
      if (!alive) return
      setManifest(loaded)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  if (manifest === null) return ready ? { ...NONE, ready: true } : NONE

  const url = (path: string | undefined) => (path === undefined ? null : `${base}faces/${path}`)

  return {
    unitFace: (typeId, faceIndex) => url(manifest.units[`${typeId}#${faceIndex}`]),
    terrainFace: (terrainTypeId, face) => url(manifest.terrains[`${terrainTypeId}#${face}`]),
    eighthFace: (icon) => url(manifest.terrains[`eighth#${icon}`]),
    ready: true,
  }
}
