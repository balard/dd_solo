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
  type PromotionPair,
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
  pendingKey,
  reinforcePlan,
  selectModeFor,
  type ReinforceMove,
} from './game/prompts'
import { sameSpellTarget, type SpellDraftCast } from '../engine/magic'

import { NewGameScreen } from './game/NewGameScreen'
import { useGame, type PlayingGame } from './game/useGame'
import { RuleSetProvider } from './game/useRuleSet'

export function App() {
  const game = useGame()
  return game.phase === 'choosing' ? (
    <NewGameScreen onStart={game.start} />
  ) : (
    // The rules go in at the fork, because this is where "there is a game" is decided
    // and a game is the only thing that has any. The one reader is a face's hover
    // label, which has to say whether that face does anything in *this* game -- see
    // `useRuleSet` for why it is not a prop.
    <RuleSetProvider ruleSet={game.state.ruleSet}>
      <GameView game={game} />
    </RuleSetProvider>
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
  // And the Wild Growth draft: which of your dice are growing into which of your
  // dead. A second list rather than a wider one -- the two questions are never asked
  // at the same time, and a pair is not a move.
  const [pairs, setPairs] = useState<readonly PromotionPair[]>([])
  // And the third draft, for the two dragon sheets: a tally under composite keys
  // (`ids.melee`, `missile.<dragonId>`). One counter map rather than two shaped
  // drafts, because both questions are "spread this pool across those buckets" and
  // neither is ever live at the same time as the other.
  const [counters, setCounters] = useState<Readonly<Record<string, number>>>({})
  // And the fourth, for the spell picker: every cast staged so far, plus which spell
  // is currently being aimed. Two fields because announcing is two taps -- pick the
  // spell, then pick its target -- and `aiming` is selection-shaped rather than
  // draft-shaped: it is "what am I pointing at", not "what have I decided".
  const [casts, setCasts] = useState<readonly SpellDraftCast[]>([])
  const [aiming, setAiming] = useState<string | null>(null)

  const [inspecting, setInspecting] = useState<UnitId | null>(null)
  const [showFallen, setShowFallen] = useState(false)
  const [openTerrain, setOpenTerrain] = useState<TerrainSlot | null>(null)

  // A selection is a draft answer to one question. When the question changes, the
  // draft is meaningless, so it goes. What counts as a change is `pendingKey` --
  // two consecutive Sleeps are two questions, not one.
  const key = pendingKey(pending)
  useEffect(() => {
    setSelection(new Set())
    setStaged([])
    setPairs([])
    setCounters({})
    setCasts([])
    setAiming(null)
    setInspecting(null)
  }, [key])


  // Every army is on screen now, so there is nothing to look away *to*: this only
  // marks which terrain the current decision is about.
  const focused = focusedSlot(state)

  const clearDraft = () => {
    setSelection(new Set())
    setStaged([])
    setPairs([])
    setCounters({})
    setCasts([])
    setAiming(null)
  }

  const count = (key_: string, by: number) =>
    setCounters((current) => ({ ...current, [key_]: Math.max(0, (current[key_] ?? 0) + by) }))

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
  // A Tower's missile can put an `assign_damage` on the human's own Reserve Army
  // (Phase 5d), which is the same grid as reinforce's, just a different reason to
  // be selectable.
  const mineReserveSelectable =
    selectMode?.side === 'reserve' || (selectMode?.side === 'mine' && selectMode.slot === 'reserve')

  // Or a `sai_target` -- Flame, Bullseye, Seize -- can aim at the *enemy's*
  // Reserve Army, which nothing before Tower ever needed to show at all.
  const theirReserveSelectable = selectMode?.side === 'theirs' && selectMode.slot === 'reserve'
  const theirReserve = livingUnits(state, enemy).filter((u) => u.location.kind === 'reserve')

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

        {(reserveShown.length > 0 || mineReserveSelectable) && (

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

              selectable={mineReserveSelectable}
              selected={selection}
              onToggle={toggle}
              inspecting={inspecting}
              onInspect={setInspecting}
            />
          </section>
        )}

        {/* A Tower's missile is the first thing in the game to target the enemy's
            Reserve Army (Phase 5d), so this is the first time it needs to be shown
            at all -- "Your reserve" above is always the human's own. */}
        {(theirReserve.length > 0 && theirReserveSelectable) && (
          <section className="army off-board">
            <h3>
              Enemy reserve{' '}
              <span className="muted">
                {theirReserve.length}d / {health(theirReserve)}h
              </span>
            </h3>
            <DiceGrid
              units={theirReserve}
              selectable={theirReserveSelectable}
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
        pairs={pairs}
        counters={counters}
        casts={casts}
        aiming={aiming}
        onAim={setAiming}
        // Two castings of one spell at one target are *one* combined spell with its
        // number multiplied, not two spells -- so staging merges rather than appends.
        onCast={(cast) =>
          setCasts((current) => {
            const at = current.findIndex(
              (c) => c.spell === cast.spell && sameSpellTarget(c.target, cast.target),
            )
            if (at === -1) return [...current, cast]
            const merged = [...current]
            merged[at] = { ...cast, count: (current[at]?.count ?? 0) + cast.count }
            return merged
          })
        }
        onStage={(moves) => setStaged((current) => [...current, ...moves])}
        onPair={(pair) => setPairs((current) => [...current, pair])}
        onCount={count}
        onClearSelection={() => setSelection(new Set())}
        onClearDraft={clearDraft}
        dispatch={dispatch}
      />

    </div>
  )
}
