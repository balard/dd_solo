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
 *
 * **Switched off, not gone.** `useGame` calls only `clearSave`, so every launch and
 * every reload starts at the start screen instead of resuming. That is deliberate
 * while the rules are still moving under the save format weekly: a record written on
 * Monday's rules and replayed on Friday's is a worse outcome than no record, and
 * "pick the forces again" is two clicks. Turning it back on is `readSave` in
 * `useGame`'s opening and `writeSave` in an effect after every action -- which is
 * why this file and its tests are kept whole rather than deleted, and why
 * `SAVE_VERSION` did **not** move for this: nothing replays, and the version is
 * about replay correctness and nothing else.
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
 *
 * 5: the app now sets `ruleSet: DUA_RULES`, and a killed Phoenix rolls a die that
 *    version 4 never rolled. Two reasons, and the second is the stronger one: a
 *    version-4 record is a version-4 game with nothing on screen saying so, exactly
 *    as in 4 above; and it carries a serialised `ruleSet` object with no `dua` key
 *    at all, so replaying it would run the engine against a `RuleSet` the type says
 *    cannot exist -- behaving as `'inert'` by accident rather than by decision.
 *
 * 6: targeting SAIs ask a question mid-exchange. A `sai_target` decision sits between
 *    the attack roll and the save roll, so a version-5 action log replayed against
 *    this engine hands its *next* answer to a question that did not exist when it was
 *    recorded -- `reduce` refuses on the kind mismatch, which is the guard working,
 *    but only after the log has already diverged. This is a decision-order bump, the
 *    plainest kind there is, and the first one since version 3 that is not mostly
 *    about which ruleset the app plays.
 *
 * 7: two reasons, Phase 5. Dice consumption at setup -- a record written by the app
 *    never pins a terrain slot, so a version-6 record replayed here draws three
 *    dice the old engine did not, and every face roll after them lands somewhere
 *    else. And decision order -- the Eighth Face Phase gains two `Pending` kinds
 *    (City, Temple), so a version-6 log's next answer can land on a question that
 *    did not exist when it was recorded, the same shape as version 6's own reason.
 *
 * 8: dragons, Phase 6, and the reason is dice consumption again -- but note which
 *    half is *not* the reason. `dragons` already existed on `RuleSet` and the new
 *    setup draws are gated on it, so a version-7 record (`dragons: false`) replays
 *    through the new `setupGame` byte for byte; the version is not protecting those,
 *    and all 25 goldens prove it by staying untouched. What it protects is the
 *    configuration the app now plays: `DRAGON_RULES` draws pool colours, forms and
 *    two Frontier seeds at setup, and adds four `Pending` kinds plus a phase that
 *    stops for them. A log recorded a moment before this lands would diverge on both
 *    counts at once.
 *
 * 9: spells, Phase 7, and this one is every reason at once -- which is what makes it
 *    the least interesting bump in the list to argue about. Dice consumption changes
 *    at setup (`magic: 'spells'` seeds no dragon on the Frontier, so the two draws
 *    Phase 6 added are gone again). Decision order changes in several places: a magic
 *    action stops to announce spells instead of dealing `floor(M / 2)` damage, every
 *    army roll may stop for a Flashfire, an announcement may stop for a Dispel Magic,
 *    and a Reserve Army may now march at all. And the app moves from `DRAGON_RULES`
 *    to `SPELL_RULES`, so a version-8 log would go on playing the old game with
 *    nothing on screen saying which.
 *
 *    Worth noting what is *still* not a reason: a version-8 record pins
 *    `magic: 'simplified'` in its own `SetupOptions`, so it would replay correctly
 *    under the old rules for as long as the engine kept them. The version is not
 *    protecting that -- `setupGame` still does. It is protecting the live one.
 */
export const SAVE_VERSION = 9


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
