/**
 * Binds a run to React (v3 Phase 4b), `useGame`'s twin one level up.
 *
 * Thin on purpose: `reduceRun` is the state machine, so this holds a `RunState`, dispatches
 * into it, and writes the save after every step (`saveRun` decides which steps). It does not
 * play battles. `App` asks for the battle's setup when the force is ready, hands it to
 * `useGame`, and reports the winner back through `dispatch`.
 *
 * **The save is read once, at launch, and never deleted by reading** (`readRun`): StrictMode
 * runs a `useState` initializer twice in development, and both must see the same save.
 * A save that cannot be carried on is cleared in an effect -- harmless to run twice -- and
 * its message is kept in state, so the start screen can say it once.
 */
import { useCallback, useEffect, useState } from 'react'

import { opponentNamed, type OpponentName } from '../../ai/opponents'
import type { SetupOptions } from '../../engine/setup'
import { battleSetup } from '../../run/battle'
import { newRun, reduceRun } from '../../run/reduce'
import type { RunLoad } from '../../run/save'
import type { RunAction, RunState } from '../../run/types'

import { clearRun, readRun, saveRun } from './runStore'

export interface RunApi {
  /** The run being played, or null on the start screen. */
  readonly run: RunState | null
  /** What the start screen offers: the save as it was read at launch or last left. */
  readonly saved: RunLoad
  /** Starts a run of this race from this seed, over whatever was saved. */
  readonly begin: (race: string, seed: number) => void
  /** Carries the saved run on. */
  readonly carryOn: () => void
  readonly dispatch: (action: RunAction) => void
  /**
   * Readies the force and returns the battle to play: the setup and the opponent, which
   * the caller hands to `useGame`. Null if the force cannot fight (the screen says why).
   */
  readonly fight: () => { readonly setup: SetupOptions; readonly opponent: OpponentName } | null
  /** Back to the start screen. The run stays saved where it was. */
  readonly leave: () => void
  /** A finished run has been seen: clear its save and go back to the start screen. */
  readonly close: () => void
}

export function useRun(): RunApi {
  // Read, not acted on: a finished run opens on its end, and a run in progress waits on
  // the start screen for Continue.
  const [saved, setSaved] = useState<RunLoad>(() => readRun())
  const [run, setRun] = useState<RunState | null>(() => {
    const load = readRun()
    return load.kind === 'ok' && load.run.status !== 'playing' ? load.run : null
  })

  useEffect(() => {
    if (saved.kind === 'outdated' || saved.kind === 'unreadable') clearRun()
  }, [saved])

  const advance = useCallback((next: RunState) => {
    saveRun(next)
    setRun(next)
  }, [])

  const begin = useCallback(
    (race: string, seed: number) => advance(reduceRun(newRun(seed), { kind: 'pick_race', race })),
    [advance],
  )

  const carryOn = useCallback(() => {
    if (saved.kind === 'ok') setRun(saved.run)
  }, [saved])

  const dispatch = useCallback(
    (action: RunAction) => setRun((current) => {
      if (current === null) return current
      const next = reduceRun(current, action)
      saveRun(next)
      return next
    }),
    [],
  )

  const fight = useCallback(() => {
    if (run === null || run.pending.kind !== 'arrange_force') return null
    let ready: RunState
    try {
      ready = reduceRun(run, { kind: 'ready' })
    } catch {
      return null
    }
    if (ready.pending.kind !== 'battle') return null
    const opponent = opponentNamed(ready.pending.encounter.opponent)
    if (opponent === null) throw new Error(`${ready.pending.encounter.id} names no opponent the app knows`)
    // Not saved: a battle in progress never is, so a reload comes back to this force.
    setRun(ready)
    return { setup: battleSetup(ready), opponent }
  }, [run])

  const leave = useCallback(() => {
    setSaved(readRun())
    setRun(null)
  }, [])

  const close = useCallback(() => {
    clearRun()
    setSaved({ kind: 'none' })
    setRun(null)
  }, [])

  return { run, saved, begin, carryOn, dispatch, fight, leave, close }
}
