/**
 * Saving and restoring a game.
 *
 * What gets stored is the record -- `{ setup, actions }` -- and nothing else. The
 * state is rebuilt by replaying it, which is possible because the RNG is a pure
 * function of `{ seed, counter }` living inside the state. So a save is a few KB,
 * it doubles as a bug report you can hand over, and it can never disagree with
 * itself the way a serialised snapshot could.
 *
 * Every access is wrapped: `localStorage` throws in a private window, when site
 * data is blocked, and when the quota is full. A game that cannot be saved should
 * still be playable.
 */
import type { GameRecord } from '../../engine/replay'

const KEY = 'dd_solo.save'

/**
 * Bump when a change would make old action logs replay differently -- new phases,
 * changed decision order, altered dice consumption. A mismatch is discarded with a
 * message rather than replayed into a wrong game.
 *
 * 2: the eighth face started granting its two standard advantages (ID results
 *    doubled, and the melee-only restriction on armies facing the holder). No die
 *    is rolled that was not rolled before, but the totals differ and actions that
 *    were illegal at a captured terrain are now legal -- so an old log replays into
 *    a different game rather than a wrong one, which is exactly what this guards.
 *
 * 3: forces are rolled from the seed, and the Frontier die is the roll-off loser's
 *    second terrain rather than a fixed Highland. An old log replays onto a board
 *    with different armies on different terrains -- a different game entirely.
 *
 * 4: the app now sets `ruleSet: SAI_RULES`. Note what this bump is *not* for: a
 *    version-3 record still replays byte-identically, because it carries no
 *    `ruleSet` and `setupGame` pins an absent one to `V0_RULES` for good. The reason
 *    is that it would go on replaying the v0 game -- no Smite, no Counter, no
 *    rerolls -- while the New Game button starts a different one, and nothing on
 *    screen says which you are playing. Discarding it is the honest option.
 */
export const SAVE_VERSION = 4

export interface SavedGame {
  readonly version: number
  readonly record: GameRecord
  readonly savedAt: string
}

export type LoadResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly save: SavedGame }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'outdated'; readonly found: number }

export function readSave(): LoadResult {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch (error) {
    return { kind: 'unreadable', reason: `storage is unavailable (${String(error)})` }
  }
  if (raw === null) return { kind: 'none' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unreadable', reason: 'the saved game is not valid JSON' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'unreadable', reason: 'the saved game is not an object' }
  }
  const save = parsed as Partial<SavedGame>

  if (typeof save.version !== 'number') {
    return { kind: 'unreadable', reason: 'the saved game has no version' }
  }
  if (save.version !== SAVE_VERSION) {
    return { kind: 'outdated', found: save.version }
  }
  if (
    typeof save.record !== 'object' ||
    save.record === null ||
    !Array.isArray(save.record.actions) ||
    typeof save.record.setup !== 'object'
  ) {
    return { kind: 'unreadable', reason: 'the saved game is missing its moves' }
  }

  return {
    kind: 'ok',
    save: {
      version: save.version,
      record: save.record,
      savedAt: typeof save.savedAt === 'string' ? save.savedAt : 'unknown',
    },
  }
}

/** Returns false if the game could not be saved; the caller can say so, quietly. */
export function writeSave(record: GameRecord): boolean {
  try {
    const save: SavedGame = { version: SAVE_VERSION, record, savedAt: new Date().toISOString() }
    window.localStorage.setItem(KEY, JSON.stringify(save))
    return true
  } catch {
    return false
  }
}

export function clearSave(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing useful to do: the save is already unreachable.
  }
}
