/**
 * The app's run save (v3 Phase 3): one run, in `localStorage`, read on launch.
 *
 * The format and the rules are `src/run/save.ts`, shared with the terminal; this is
 * only the edge. Every access is wrapped -- `localStorage` throws in a private window,
 * with site data blocked and on a full quota -- and a run that cannot be saved must
 * still be playable. The storage is a parameter so the tests can hand it a fake one,
 * and one that throws.
 *
 * - **One run at a time**, under one key. Whether "New run" may overwrite it is the
 *   screen's question, asked through `runInProgress`.
 * - **Written whenever the run rests outside a battle** (`shouldSave`), so leaving
 *   mid-battle comes back to that encounter's start, and the same board.
 * - **A finished run is written too**, so it is shown once on the next launch; the screen
 *   clears it when it has been shown.
 * - **A save that cannot be carried on is discarded on read**, and the read says why,
 *   for the screen to tell the player.
 * - **The single-game save is untouched**: `storage.ts` and `SAVE_VERSION` stay off.
 */
import { parseRunSave, serializeRun, shouldSave, type RunLoad } from '../../run/save'
import type { RunState } from '../../run/types'

const KEY = 'dd_solo.run'

/** What a run save needs of `localStorage`. */
export type RunStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The browser's storage, or null where there is none to be had. */
function browserStorage(): RunStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** The saved run, if any. A save that cannot be carried on is discarded here, and the
 *  result says why. */
export function readRun(storage: RunStorage | null = browserStorage()): RunLoad {
  if (storage === null) return { kind: 'none' }
  let raw: string | null
  try {
    raw = storage.getItem(KEY)
  } catch (error) {
    return { kind: 'unreadable', reason: `storage is unavailable (${String(error)})` }
  }
  const load = parseRunSave(raw)
  if (load.kind === 'outdated' || load.kind === 'unreadable') clearRun(storage)
  return load
}

/**
 * Writes the run when it rests outside a battle, and leaves the last save alone inside
 * one. False only when a write was due and failed -- the caller may say so, quietly.
 */
export function saveRun(run: RunState, storage: RunStorage | null = browserStorage(), now: Date = new Date()): boolean {
  if (!shouldSave(run)) return true
  if (storage === null) return false
  try {
    storage.setItem(KEY, serializeRun(run, now.toISOString()))
    return true
  } catch {
    return false
  }
}

export function clearRun(storage: RunStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(KEY)
  } catch {
    // Nothing useful to do: the save is already unreachable.
  }
}

/** Whether a load is a run still being played: what "New run" must ask about first. */
export function runInProgress(load: RunLoad): boolean {
  return load.kind === 'ok' && load.run.status === 'playing'
}
