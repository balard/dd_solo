/**
 * Per-viewer conveniences (v2 Phase 3b): whether the log is open, and later the board
 * layout (3d). Not a save -- saving is off -- and nothing here changes a game.
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
  try {
    window.localStorage.setItem(PREFIX + name, value ? '1' : '0')
  } catch {
    // Not kept. The app works the same, and forgets on reload.
  }
}
