/**
 * The game.
 *
 * Layout is phone-first: a compact always-visible board strip, one focused terrain
 * where the playing happens, the running log, and a sticky action bar driven
 * entirely by `state.pending`. Wider screens just get more room.
 *
 * `App` itself is only the fork between the start screen and the board. The split is
 * forced rather than tidy: `GameView` holds hooks for the selection and inspection
 * drafts, so the phase check cannot be an early return inside it.
 */
import { useEffect, useMemo, useState } from 'react'

import { unitType } from '../data/load'
import {
  buriedUnits,
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
import {
  focusedSlot,
  reinforcePlan,
  selectModeFor,
  type ReinforceMove,
} from './game/prompts'

import { NewGameScreen } from './game/NewGameScreen'
import { useGame, type PlayingGame } from './game/useGame'

export function App() {
  const game = useGame()
  return game.phase === 'choosing' ? (
    <NewGameScreen onStart={game.start} />
  ) : (
    <GameView game={game} />
  )
}

function GameView({ game }: { readonly game: PlayingGame }) {
  const { state, human, seed, origin, dispatch, newGame, opponentThinking } = game
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const pending = state.pending

  const [selection, setSelection] = useState<ReadonlySet<UnitId>>(new Set())
  // The other half of the reinforce draft. Selection says *which* dice; this says
  // where the ones already placed are going, so the Reinforce Step can split a
  // reserve across terrains instead of committing it all to one.
  const [staged, setStaged] = useState<readonly ReinforceMove[]>([])

  const [inspecting, setInspecting] = useState<UnitId | null>(null)
  const [showFallen, setShowFallen] = useState(false)
  const [openTerrain, setOpenTerrain] = useState<TerrainSlot | null>(null)

  // A selection is a draft answer to one question. When the question changes, the
  // draft is meaningless, so it goes.
  const pendingKey = pending === null ? 'none' : `${pending.kind}:${pending.player}`
  useEffect(() => {
    setSelection(new Set())
    setStaged([])
    setInspecting(null)
  }, [pendingKey])


  // Every army is on screen now, so there is nothing to look away *to*: this only
  // marks which terrain the current decision is about.
  const focused = focusedSlot(state)

  const clearDraft = () => {
    setSelection(new Set())
    setStaged([])
  }

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
  // Mid-reinforce the grid offers only the dice still without a destination, so a
  // die cannot be staged twice and the count reads as "still to place".
  const plan =
    pending?.kind === 'reinforce' && pending.player === human
      ? reinforcePlan(state, human, staged)
      : null
  const reserveShown = plan?.unassigned ?? reserve

  const myFallen = deadUnits(state, human)
  const theirFallen = deadUnits(state, enemy)
  // Shown in the same disclosure as the fallen, and labelled apart from them: the
  // DUA is a resource units come back out of, the BUA is where they stop. Nothing
  // buries until Phase 4, so these two are empty in every game today.
  const myBuried = buriedUnits(state, human)
  const theirBuried = buriedUnits(state, enemy)
  const anyBuried = myBuried.length > 0 || theirBuried.length > 0

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
              window.confirm('Abandon this game and pick new forces?')
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
      {/* The address bar named this game, and has been cleared so a refresh lands on
          the start screen rather than running the link again. Saying so is the only
          sign the request was honoured -- a bestiary board otherwise just looks like
          a lucky roll. */}
      {origin.kind === 'requested' && (
        <p className="banner muted">
          {origin.forces === null ? (
            <>
              Started seed <b>{origin.seed}</b>, as the link asked.
            </>
          ) : (
            <>
              Started the <b>{origin.forces}</b> forces on seed <b>{origin.seed}</b>, as the link
              asked.
            </>
          )}
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

        {(reserveShown.length > 0 || selectMode?.side === 'reserve') && (

          <section className="army off-board">
            <h3>
              Your reserve{' '}
              <span className="muted">
                {reserveShown.length}d / {health(reserveShown)}h
                {plan !== null && plan.moves.length > 0 ? ' still to place' : ''}
              </span>
            </h3>
            <DiceGrid
              units={reserveShown}

              selectable={selectMode?.side === 'reserve'}
              selected={selection}
              onToggle={toggle}
              inspecting={inspecting}
              onInspect={setInspecting}
            />
          </section>
        )}

        {(myFallen.length > 0 || theirFallen.length > 0 || anyBuried) && (
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
                  {anyBuried ? ` · buried ${myBuried.length}/${theirBuried.length}` : ''}
                </span>
              </button>
            </h3>
            {showFallen && (
              <div className="fallen">
                <p className="fallen-side muted">Yours</p>
                <DiceGrid units={myFallen} inspecting={inspecting} onInspect={setInspecting} />
                <p className="fallen-side muted">Enemy</p>
                <DiceGrid units={theirFallen} inspecting={inspecting} onInspect={setInspecting} />
                {myBuried.length > 0 && (
                  <>
                    <p className="fallen-side muted">Yours, buried</p>
                    <DiceGrid units={myBuried} inspecting={inspecting} onInspect={setInspecting} />
                  </>
                )}
                {theirBuried.length > 0 && (
                  <>
                    <p className="fallen-side muted">Enemy, buried</p>
                    <DiceGrid units={theirBuried} inspecting={inspecting} onInspect={setInspecting} />
                  </>
                )}
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
        staged={staged}
        onStage={(moves) => setStaged((current) => [...current, ...moves])}
        onClearSelection={() => setSelection(new Set())}
        onClearDraft={clearDraft}
        dispatch={dispatch}
      />

    </div>
  )
}
