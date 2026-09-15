/**
 * The game.
 *
 * Layout is phone-first: a compact always-visible board strip, one focused terrain
 * where the playing happens, the running log, and a sticky action bar driven
 * entirely by `state.pending`. Wider screens just get more room.
 */
import { useEffect, useMemo, useState } from 'react'

import { unitType } from '../data/load'
import {
  armyAt,
  livingUnits,
  type PlayerId,
  type TerrainSlot,
  type UnitId,
} from '../engine/types'

import { ActionBar } from './game/ActionBar'
import { BoardStrip } from './game/BoardStrip'
import { DiceGrid } from './game/DiceGrid'
import { LogPanel } from './game/LogPanel'
import { focusedSlot, slotLabel } from './game/prompts'
import { useGame } from './game/useGame'

export function App() {
  const game = useGame()
  const { state, human, seed, dispatch, newGame, opponentThinking } = game
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const pending = state.pending

  const [manualFocus, setManualFocus] = useState<TerrainSlot | null>(null)
  const [selection, setSelection] = useState<ReadonlySet<UnitId>>(new Set())

  // A selection is a draft answer to one question. When the question changes, the
  // draft is meaningless, so it goes.
  const pendingKey = pending === null ? 'none' : `${pending.kind}:${pending.player}`
  useEffect(() => {
    setSelection(new Set())
  }, [pendingKey])

  // Follow the game unless the player has deliberately looked elsewhere; a new
  // decision about a different terrain takes the focus back.
  const engineFocus = focusedSlot(state)
  useEffect(() => {
    setManualFocus(null)
  }, [engineFocus])
  const focused = manualFocus ?? engineFocus

  const toggle = (id: UnitId) =>
    setSelection((current) => {
      if (id === '') return current
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const mine = armyAt(state, human, focused)
  const theirs = armyAt(state, enemy, focused)

  // Which grid is selectable depends on what is being asked.
  const selectMode = useMemo(() => {
    if (pending === null || pending.player !== human) return null
    if (pending.kind === 'assign_damage') return { side: 'mine' as const, slot: pending.slot }
    if (pending.kind === 'retreat') return { side: 'mine' as const, slot: null }
    if (pending.kind === 'reinforce') return { side: 'reserve' as const, slot: null }
    return null
  }, [pending, human])

  const reserve = livingUnits(state, human).filter((u) => u.location.kind === 'reserve')
  const health = (units: readonly { typeId: string }[]) =>
    units.reduce((n, u) => n + unitType(u.typeId).health, 0)

  const turn = state.log.filter((e) => e.kind === 'turn_end').length + 1

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>dd_solo</h1>
          <p className="sub">
            Turn {turn} ·{' '}
            {state.winner !== null
              ? 'game over'
              : state.turn.marching === human
                ? 'your march'
                : 'enemy march'}{' '}
            · seed {seed}
          </p>
        </div>
        <button type="button" className="choice secondary" onClick={() => newGame()}>
          New game
        </button>
      </header>

      <BoardStrip state={state} human={human} focused={focused} onFocus={setManualFocus} />

      <main className="focus">
        <h2 className="focus-head">
          {slotLabel(focused, human)}
          <span className="muted">
            {state.terrains[focused].face === 8
              ? ' · captured'
              : ` · face ${state.terrains[focused].face}`}
          </span>
        </h2>

        <section className="army">
          <h3>
            Enemy <span className="muted">{theirs.length}d / {health(theirs)}h</span>
          </h3>
          <DiceGrid units={theirs} />
        </section>

        <section className="army">
          <h3>
            Your army <span className="muted">{mine.length}d / {health(mine)}h</span>
          </h3>
          <DiceGrid
            units={mine}
            selectable={selectMode?.side === 'mine'}
            selected={selection}
            onToggle={toggle}
          />
        </section>

        {(reserve.length > 0 || selectMode?.side === 'reserve') && (
          <section className="army">
            <h3>
              Your reserve <span className="muted">{reserve.length}d / {health(reserve)}h</span>
            </h3>
            <DiceGrid
              units={reserve}
              selectable={selectMode?.side === 'reserve'}
              selected={selection}
              onToggle={toggle}
            />
          </section>
        )}

        <LogPanel state={state} human={human} />
      </main>

      <ActionBar
        state={state}
        human={human}
        pending={pending}
        opponentThinking={opponentThinking}
        selection={selection}
        onClearSelection={() => setSelection(new Set())}
        dispatch={dispatch}
      />
    </div>
  )
}
