/**
 * Forces the army builder has kept, per viewer (v2 Phase 4b).
 *
 * **A convenience store, not a save.** Saving games stays off until v3, and this keeps
 * none: it keeps the forces somebody built, so a playtest can be repeated without
 * building the force again. Losing it costs a rebuild, never a game, so it has no
 * version -- the `prefs.ts` rule, not the `storage.ts` one. An entry is kept as it was
 * built, and whether it is still *legal* (the data may have moved under it) is asked
 * fresh by `forceProblems` every time it is shown.
 *
 * The parsing is pure and tested in node; the two functions that touch `localStorage`
 * are the thin, wrapped edge. It throws in a private window, with site data blocked and
 * on a full quota, and a builder that cannot keep a force must still build one.
 */
import { readBuiltForce, type BuiltForce } from '../../engine/force'

export interface SavedForce {
  readonly id: string
  readonly name: string
  /** The collection it was built from, by id: a limited force is only legal against
   *  what that collection holds. */
  readonly collection: string
  readonly cap: number
  readonly force: BuiltForce
}

const KEY = 'dd_solo.forces'

/**
 * The kept forces from what `localStorage` held, which is as untrusted as a file: a
 * store that is missing or unreadable is empty, and an entry that is not a force is
 * dropped on its own rather than taking the rest down with it.
 */
export function parseSavedForces(raw: string | null): readonly SavedForce[] {
  if (raw === null) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (value as { forces?: unknown } | null)?.forces
  if (!Array.isArray(list)) return []

  const kept: SavedForce[] = []
  for (const entry of list as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, name, collection, cap, force } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string' || typeof collection !== 'string') continue
    if (typeof cap !== 'number' || !Number.isFinite(cap)) continue
    const read = readBuiltForce(force, name)
    if ('problem' in read) continue
    kept.push({ id, name, collection, cap, force: read.force })
  }
  return kept
}

export function serializeSavedForces(forces: readonly SavedForce[]): string {
  return JSON.stringify({ forces })
}

/** Replaces the force with the same id, or adds it at the end. */
export function upsertForce(forces: readonly SavedForce[], entry: SavedForce): readonly SavedForce[] {
  return forces.some((f) => f.id === entry.id)
    ? forces.map((f) => (f.id === entry.id ? entry : f))
    : [...forces, entry]
}

export function removeForce(forces: readonly SavedForce[], id: string): readonly SavedForce[] {
  return forces.filter((f) => f.id !== id)
}

/** A fresh id for a force, unique among those kept. */
export function newForceId(forces: readonly SavedForce[], now: number): string {
  let n = now
  while (forces.some((f) => f.id === `force-${n}`)) n++
  return `force-${n}`
}

export function readSavedForces(): readonly SavedForce[] {
  try {
    return parseSavedForces(window.localStorage.getItem(KEY))
  } catch {
    return []
  }
}

export function writeSavedForces(forces: readonly SavedForce[]): void {
  try {
    window.localStorage.setItem(KEY, serializeSavedForces(forces))
  } catch {
    // Not kept. The builder works the same, and forgets on reload.
  }
}
