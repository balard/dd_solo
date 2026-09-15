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
  deadUnits,
  livingUnits,
  speciesOf,
  type PlayerId,
  type TerrainSlot,
  type UnitId,
} from '../engine/types'

import { ActionBar } from './game/ActionBar'
import { Board } from './game/Board'
import { DiceGrid } from './game/DiceGrid'
import { speciesInfo } from './game/Elements'
import { LogPanel } from './game/LogPanel'
import { focusedSlot, selectModeFor } from './game/prompts'
import { useGame } from './game/useGame'

export function App() {
  const game = useGame()
  const { state, human, seed, origin, saving, dispatch, newGame, opponentThinking } = game
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const pending = state.pending

  const [selection, setSelection] = useState<ReadonlySet<UnitId>>(new Set())
  const [inspecting, setInspecting] = useState<UnitId | null>(null)
  const [showFallen, setShowFallen] = useState(false)
  const [openTerrain, setOpenTerrain] = useState<TerrainSlot | null>(null)

  // A selection is a draft answer to one question. When the question changes, the
  // draft is meaningless, so it goes.
  const pendingKey = pending === null ? 'none' : `${pending.kind}:${pending.player}`
  useEffect(() => {
    setSelection(new Set())
    setInspecting(null)
  }, [pendingKey])

  // Every army is on screen now, so there is nothing to look away *to*: this only
  // marks which terrain the current decision is about.
  const focused = focusedSlot(state)

  const toggle = (id: UnitId) =>
    setSelection((current) => {
      if (id === '') return current
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Which grid is selectable depends on what is being asked. The rule itself lives
  // in prompts.ts, where it is testable without a DOM.
  const selectMode = useMemo(() => selectModeFor(pending, human), [pending, human])

  // Read off the dice rather than the setup: a force may have been rolled, in which
  // case there is no preset id to look up, and the units know anyway.
  const speciesName = (player: PlayerId) => speciesInfo(speciesOf(state, player))
  const mySpecies = speciesName(human)
  const theirSpecies = speciesName(enemy)

  const reserve = livingUnits(state, human).filter((u) => u.location.kind === 'reserve')
  const myFallen = deadUnits(state, human)
  const theirFallen = deadUnits(state, enemy)
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
        <button
          type="button"
          className="choice secondary"
          onClick={() => {
            const started = state.log.some((e) => e.kind === 'march_begin')
            if (
              state.winner !== null ||
              !started ||
              window.confirm('Abandon this game and start a new one?')
            ) {
              newGame()
            }
          }}
        >
          New game
        </button>
      </header>

      {origin.kind === 'recovered' && (
        <p className="banner warn">
          Started a new game &mdash; {origin.reason}.
        </p>
      )}
      {origin.kind === 'resumed' && state.winner === null && (
        <p className="banner muted">Resumed your saved game.</p>
      )}
      {!saving && (
        <p className="banner warn">
          This game cannot be saved &mdash; the browser is refusing to store it. It will be lost
          when you close the tab.
        </p>
      )}

      {/* One scrolling page: board, then what is off the board, then the log.
          The log used to sit in its own column beside the board, which does not
          survive giving every terrain its dice -- there is no width left for it. */}
      <main className="page">
        <Board
          state={state}
          human={human}
          focused={focused}
          openTerrain={openTerrain}
          onToggleFaces={(slot) => setOpenTerrain((open) => (open === slot ? null : slot))}
          selectMode={selectMode}
          selected={selection}
          onToggle={toggle}
          inspecting={inspecting}
          onInspect={setInspecting}
          mySpecies={mySpecies}
          theirSpecies={theirSpecies}
        />

        {(reserve.length > 0 || selectMode?.side === 'reserve') && (
          <section className="army off-board">
            <h3>
              Your reserve{' '}
              <span className="muted">
                {reserve.length}d / {health(reserve)}h
              </span>
            </h3>
            <DiceGrid
              units={reserve}
              selectable={selectMode?.side === 'reserve'}
              selected={selection}
              onToggle={toggle}
              inspecting={inspecting}
              onInspect={setInspecting}
            />
          </section>
        )}

        {(myFallen.length > 0 || theirFallen.length > 0) && (
          <section className="army off-board">
            <h3>
              <button
                type="button"
                className="fallen-toggle"
                onClick={() => setShowFallen((v) => !v)}
              >
                {showFallen ? '▾' : '▸'} Fallen
                <span className="muted">
                  {' '}
                  you {myFallen.length} · enemy {theirFallen.length}
                </span>
              </button>
            </h3>
            {showFallen && (
              <div className="fallen">
                <p className="fallen-side muted">Yours</p>
                <DiceGrid units={myFallen} inspecting={inspecting} onInspect={setInspecting} />
                <p className="fallen-side muted">Enemy</p>
                <DiceGrid units={theirFallen} inspecting={inspecting} onInspect={setInspecting} />
              </div>
            )}
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
