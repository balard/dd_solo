/**
 * The dice the roll card on screen is about to change (v2 Phase 9c), and what it does
 * to each: "falls", "buried", "Flame", "to reserves".
 *
 * A context, for `useRuleSet`'s reason: the reader is every die tile, wherever it is
 * drawn -- both boards, the reserves, the DUA -- and a grid that forgot the prop would
 * be the one place a die vanished without its mark, silently. It carries nothing but
 * the marks; the board itself is still drawn from props (`PlayingGame.board`).
 */
import { createContext, useContext, type ReactNode } from 'react'

import type { UnitId } from '../../engine/types'

const NONE: ReadonlyMap<UnitId, string> = new Map()

const MarksContext = createContext<ReadonlyMap<UnitId, string>>(NONE)

export function MarksProvider({
  marks,
  children,
}: {
  marks: ReadonlyMap<UnitId, string>
  children: ReactNode
}) {
  return <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>
}

export function useMarks(): ReadonlyMap<UnitId, string> {
  return useContext(MarksContext)
}
