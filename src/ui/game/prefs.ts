/**
 * Per-viewer conveniences: whether the log is open (v2 Phase 3b), and which board
 * layout this viewer chose (3d). Not a save -- saving is off -- and nothing here
 * changes a game.
 *
 * Kept apart from `storage.ts` on purpose: that file is the dormant save format, with a
 * version whose whole meaning is replay correctness. A preference has no version,
 * because losing one costs a click.
 *
 * Every access is wrapped. `localStorage` throws in a private window, with site data
 * blocked, and on a full quota; a preference that cannot be kept is simply not kept.
 */

const PREFIX = 'dd_solo.pref.'

export function readFlag(name: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(PREFIX + name)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

export function writeFlag(name: string, value: boolean): void {
  writeText(name, value ? '1' : '0')
}

/** A preference that is one of a few words -- the board layout. Null when unset. */
export function readText(name: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + name)
  } catch {
    return null
  }
}

export function writeText(name: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + name, value)
  } catch {
    // Not kept. The app works the same, and forgets on reload.
  }
}
