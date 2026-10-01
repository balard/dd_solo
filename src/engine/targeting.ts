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
export type TargetTask =
  | {
      readonly kind: 'enemy'
      /** For the log and the prompt. Nothing branches on it. */
      readonly sai: string
      /** Health-worth to pick from the army this roll is aimed at. */
      readonly health: number
      readonly escape: 'none' | 'save' | 'maneuver' | 'id'
      /** Roar's `'reserve'` and Stomp's `'save_or_bury'` from v2 Phase 6d. */
      readonly fate: 'kill' | 'bury' | 'reserve' | 'save_or_bury'
      /** Seize: where an escapee goes. Omitted means it stays where it stood. */
      readonly escapeTo?: 'reserve'
      /**
       * Bullseye and Double Strike: the die to throw again once this task has fully
       * resolved -- "roll this unit again", which the rules put after the kill. A
       * step-3 task, so never combined with another. Omitted on every other task.
       */
      readonly rerollAfter?: string
      /** Swallow: one unit, not health-worth -- `health` is unread. Never combined. */
      readonly one?: true
    }
  /** Sleep: one unit in the army being attacked. */
  | { readonly kind: 'sleep'; readonly sai: string }
  /** Galeforce: one opposing army, at any terrain. */
  | { readonly kind: 'galeforce'; readonly sai: string }
  /** Choke: kill health-worth of the defenders that rolled an ID, results and all. */
  | { readonly kind: 'choke'; readonly sai: string; readonly health: number }
  /** Confuse: reroll health-worth of the defenders, discarding what they had. */
  | { readonly kind: 'confuse'; readonly sai: string; readonly health: number }
  /** Wild Growth: split a budget between save results and promotions, at home. */
  | { readonly kind: 'promote'; readonly sai: string; readonly budget: number }
  /**
   * Firewalking, Teleport: move `unitId` and up to `health` health-worth of its army
   * anywhere.
   *
   * The only task that names the die that made it, because "this unit may move
   * itself" is a rule about that die and not about the army it came from.
   */
  | { readonly kind: 'move'; readonly sai: string; readonly unitId: string; readonly health: number }
  /**
   * Cantrip: a pool of magic that may only buy spells marked `C`, spent now.
   *
   * Combines like the budgets do -- two Cantrip faces in one roll are one pool of
   * their sum, which is the ordinary rule and not a special case.
   */
  | { readonly kind: 'cantrip'; readonly sai: string; readonly points: number }
  /**
   * Hypnotic Glare: every defender that rolled an ID, hypnotized. No decision -- the
   * delayed pause applies it on its own -- and `sources` is every die that glared, so a
   * victim stays hypnotized while any of them still does. Combined by name, as a union.
   */
  | { readonly kind: 'glare'; readonly sai: string; readonly sources: readonly string[] }
  /**
   * Bash (v2 Phase 6d): one die of the *attacking* army takes its own melee as damage,
   * and the defender's save roll gains as many saves. Owned by the defender, who rolled
   * it, and aimed at the attacker -- the one task `taskOwner` answers that way. Never
   * combined: it targets an individual unit (p. 32).
   */
  | { readonly kind: 'bash'; readonly sai: string }

/** The effect kinds that wait for the save dice: step 2, "Delayed Effects". */
const DELAYED: readonly RollEffect['kind'][] = ['choke', 'confuse', 'glare']

/**
 * The tasks a roll owes, in roll order, with same-SAI budgets summed.
 *
 * Grouping is by SAI *name*, not by shape: two Flames combine, a Flame and a Smother
 * do not, even though both are `target_enemy`. Two effects of one name always agree
 * on `escape` and `fate`, because they came from the same handler.
 *
 * **Two doors, because a roll owes its tasks at two different moments.** Everything
 * here is chosen before the defender rolls; `delayedTasks` below is chosen after,
 * because Choke's legal targets are "units that rolled an ID icon" and Confuse throws
 * a rolled face away. That is the rulebook's own split -- step 2 of the sequence is
 * "when rolling for saves against an attack, Delayed Effects are applied now" -- and
 * not a convenience.
 */
export function targetTasks(effects: readonly RollEffect[]): readonly TargetTask[] {
  return build(effects.filter((effect) => !DELAYED.includes(effect.kind)))
}

/** The tasks that wait until the save dice are on the table. */
export function delayedTasks(effects: readonly RollEffect[]): readonly TargetTask[] {
  return build(effects.filter((effect) => DELAYED.includes(effect.kind)))
}

function build(effects: readonly RollEffect[]): readonly TargetTask[] {
  const tasks: TargetTask[] = []
  const combinableAt = new Map<string, number>()

  for (const effect of effects) {
    // The ones that are never combined, each for its own reason from p. 32: Sleep
    // targets an individual unit, two Galeforces may legitimately name two different
    // armies -- so merging them would silently throw one away -- and a free move is
    // named there outright, "SAIs that move units out of the army ... are always
    // resolved one by one". A free move also *is* a particular die, so there is
    // nothing to merge it into.
    if (effect.kind === 'sleep' || effect.kind === 'galeforce' || effect.kind === 'bash') {
      tasks.push({ kind: effect.kind, sai: effect.sai })
      continue
    }
    // Swallow: one individual unit, so never combined either -- two Swallows are two
    // units, each rolling for its own life.
    if (effect.kind === 'target_enemy' && effect.one === true) {
      const task = taskFor(effect)
      if (task !== null) tasks.push(task)
      continue
    }
    if (effect.kind === 'free_move') {
      tasks.push({ kind: 'move', sai: effect.sai, unitId: effect.unitId, health: effect.health })
      continue
    }

    const at = combinableAt.get(effect.sai)
    if (at !== undefined) {
      const existing = tasks[at]
      if (existing !== undefined) tasks[at] = combined(existing, effect)
      continue
    }

    const task = taskFor(effect)
    if (task === null) continue
    combinableAt.set(effect.sai, tasks.length)
    tasks.push(task)
  }

  return tasks
}

/** One effect as a fresh task, or null for an effect that owes no decision. */
function taskFor(effect: RollEffect): TargetTask | null {
  switch (effect.kind) {
    case 'target_enemy':
      return {
        kind: 'enemy',
        sai: effect.sai,
        health: effect.health,
        escape: effect.escape,
        fate: effect.fate,
        // Omitted rather than defaulted: this object goes into `combat.attack.targets`,
        // which `digestState` renders through `stableJson(state.turn)`.
        ...(effect.escapeTo !== undefined ? { escapeTo: effect.escapeTo } : {}),
        ...(effect.one === true ? { one: true as const } : {}),
      }
    case 'choke':
    case 'confuse':
      return { kind: effect.kind, sai: effect.sai, health: effect.health }
    case 'cantrip':
      return { kind: 'cantrip', sai: effect.sai, points: effect.points }
    case 'wild_growth':
      return { kind: 'promote', sai: effect.sai, budget: effect.budget }
    case 'glare':
      return { kind: 'glare', sai: effect.sai, sources: [effect.unitId] }
    default:
      return null
  }
}

/** Two dice of one SAI as a single larger effect (p. 27). */
function combined(existing: TargetTask, effect: RollEffect): TargetTask {
  if (existing.kind === 'enemy' && effect.kind === 'target_enemy') {
    return { ...existing, health: existing.health + effect.health }
  }
  if ((existing.kind === 'choke' || existing.kind === 'confuse') && 'health' in effect) {
    return { ...existing, health: existing.health + effect.health }
  }
  if (existing.kind === 'promote' && effect.kind === 'wild_growth') {
    return { ...existing, budget: existing.budget + effect.budget }
  }
  if (existing.kind === 'cantrip' && effect.kind === 'cantrip') {
    return { ...existing, points: existing.points + effect.points }
  }
  if (existing.kind === 'glare' && effect.kind === 'glare') {
    return existing.sources.includes(effect.unitId)
      ? existing
      : { ...existing, sources: [...existing.sources, effect.unitId] }
  }
  return existing
}
