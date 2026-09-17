/**
 * The rules the game on screen is being played under.
 *
 * A context rather than a prop, for the same reason `useFaceArt` is a hook: the
 * things that need it are a tooltip deep inside a die tile and another inside a roll
 * strip, and threading a `RuleSet` to them means touching fourteen call sites of
 * `DiceGrid` and `RollStrip` that have no other use for it. Worse, it means a *new*
 * call site can forget it -- and forgetting it is silent, which is exactly the failure
 * this exists to fix.
 *
 * Only `faceLabel` reads it today. It is deliberately not a general channel for game
 * state: everything else still renders from `state.pending` and props, and a component
 * reaching in here for anything but "which rules are these" is a smell.
 */
import { createContext, useContext, type ReactNode } from 'react'

import type { RuleSet } from '../../engine/types'

/**
 * `null` is "nobody said", and it is a real answer rather than a missing one: a label
 * with no rules to judge by says nothing about them instead of guessing. A default of
 * `V0_RULES` or `DUA_RULES` would make an absent provider look like a deliberate
 * answer, and one of the two would be wrong.
 */
const RuleSetContext = createContext<RuleSet | null>(null)

export function RuleSetProvider({
  ruleSet,
  children,
}: {
  ruleSet: RuleSet
  children: ReactNode
}) {
  return <RuleSetContext.Provider value={ruleSet}>{children}</RuleSetContext.Provider>
}

export function useRuleSet(): RuleSet | null {
  return useContext(RuleSetContext)
}
