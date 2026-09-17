/**
 * What a roll's targeting SAIs ask the roller to decide, and in what order.
 *
 * A pure function of a `RollEffect[]` -- no `GameState`, no RNG -- for the same
 * reason `sai.ts` is: the two rules below are rulebook prose, and prose is best
 * tested from a literal rather than through a game.
 *
 * **Two house rules, both recorded in `RULES-V0.md` section 11.**
 *
 * *Order is the order the dice were rolled.* The rules let the roller choose which
 * SAI to apply first (p. 27, step 4: "apply their effects one by one in whatever
 * order you choose"). v1 fixes it to the order `RollOutcome.effects` already comes in
 * -- unit order, then step-3 rerolls -- which is the canonical order every other
 * roll-derived list in the engine uses. The choice is only ever real when one SAI
 * shrinks an army that a later one must then pick maximally from, and a "choose the
 * order" pending would be a question `PassiveAI` could hold no opinion about.
 *
 * *Multiples of the same SAI are combined where the rules allow it.* The rulebook
 * says *may* ("Multiples of the same SAI may be combined to create a single larger
 * effect", p. 27). v1 always does, because combining is never worse for the roller --
 * two Flames of two health-worth kill nothing against a 3-health die, where one Flame
 * of four kills it -- and the roller is forced to a maximum anyway, so the option is
 * not a decision. p. 32 names the exceptions: SAIs that target an individual unit, or
 * that move units out of the army, "may not be combined and are always resolved one
 * by one". Those arrive with Sleep and the free moves, and get their own `kind`s.
 */
import type { RollEffect } from './pipeline'

/** One decision the roller owes, after combination. */
export type TargetTask = {
  readonly kind: 'enemy'
  /** For the log and the prompt. Nothing branches on it. */
  readonly sai: string
  /** Health-worth to pick from the army this roll is aimed at. */
  readonly health: number
  readonly escape: 'none' | 'save' | 'maneuver' | 'id'
  readonly fate: 'kill' | 'bury'
}

/**
 * The tasks a roll owes, in roll order, with same-SAI budgets summed.
 *
 * Grouping is by SAI *name*, not by shape: two Flames combine, a Flame and a Smother
 * do not, even though both are `target_enemy`. Two effects of one name always agree
 * on `escape` and `fate`, because they came from the same handler.
 */
export function targetTasks(effects: readonly RollEffect[]): readonly TargetTask[] {
  const tasks: TargetTask[] = []
  const bySai = new Map<string, number>()

  for (const effect of effects) {
    if (effect.kind !== 'target_enemy') continue

    const at = bySai.get(effect.sai)
    if (at !== undefined) {
      const existing = tasks[at]
      if (existing !== undefined) {
        tasks[at] = { ...existing, health: existing.health + effect.health }
      }
      continue
    }

    bySai.set(effect.sai, tasks.length)
    tasks.push({
      kind: 'enemy',
      sai: effect.sai,
      health: effect.health,
      escape: effect.escape,
      fate: effect.fate,
    })
  }

  return tasks
}
