/**
 * How long a game has run (v2 Phase 3e), ticking once a second until it ends.
 *
 * Wall time, roll cards and thinking included: a pacing test asks how long a game
 * takes to play, not how long the engine spent on it.
 */
import { useEffect, useState } from 'react'

export function useClock(startedAt: number, endedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endedAt !== null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [endedAt])
  return (endedAt ?? now) - startedAt
}
