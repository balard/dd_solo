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
import { useCallback, useEffect, useMemo, useState } from 'react'

import { unitType } from '../data/load'
import {
  buriedUnits,
  deadUnits,

  livingUnits,
  pooledDragons,
  forceSpecies,
  type PlayerId,
  type PromotionPair,
  type UnitId,
} from '../engine/types'

import { ActionBar } from './game/ActionBar'
import { Board, DragonRow, EffectList } from './game/Board'
import { DiceGrid } from './game/DiceGrid'
import { speciesInfo } from './game/Elements'
import { LogPanel } from './game/LogPanel'
import {
  effectsOnPlayer,
  focusedSlot,
  pendingKey,
  pickModeFor,
  reinforcePlan,
  tapMeaning,
  type ReinforceMove,
} from './game/prompts'
import { stageCast, type SpellAim, type SpellDraftCast } from '../engine/magic'

import { Inspector, type InspectTarget } from './game/Inspector'
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
  const { state, human, seed, opponent, origin, dispatch, newGame, opponentThinking } = game
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
  // Which spell is being aimed, and which element is paying for it once that has been
  // chosen. An Elemental spell accepts either of the caster's colours, so announcing
  // one is three taps rather than two -- and `element` is what distinguishes "I have
  // picked the spell" from "I have picked how to pay for it".
  const [aiming, setAiming] = useState<SpellAim | null>(null)

  // One thing open at a time, whatever it is (Phase 9e). There used to be two states
  // here -- a unit or dragon id, and a terrain -- and opening one never closed the other.
  const [inspect, setInspect] = useState<InspectTarget | null>(null)
  const [showFallen, setShowFallen] = useState(false)
  // "Look at dice" (Phase 9e): while a decision is selecting dice, a tap inspects instead
  // of selecting -- and the selection draft stays exactly as it was.
  const [looking, setLooking] = useState(false)

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
    setInspect(null)
    setLooking(false)
  }, [key])

  // The grids and strips speak in ids; a dragon's id is never a unit's, so which kind
  // of panel it opens is a lookup, not a second callback.
  const inspecting = inspect === null || inspect.kind === 'terrain' ? null : inspect.id
  const onInspect = useCallback(
    (id: UnitId | null) =>
      setInspect(
        id === null ? null : id in state.dragons ? { kind: 'dragon', id } : { kind: 'unit', id },
      ),
    [state.dragons],
  )
  const closeInspector = useCallback(() => setInspect(null), [])
  const openTerrain = inspect?.kind === 'terrain' ? inspect.slot : null


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

  /**
   * A tap on any die that is part of the answer (Phase 9f). What it means is
   * `tapMeaning`'s to say -- in or out of the selection, the only pick in its group,
   * a promotion's partner, a spell's target -- and this only does it.
   */
  const onTap = (id: UnitId) => {
    const tap = tapMeaning(state, pending, selection, pairs, aiming, id)
    switch (tap.kind) {
      case 'toggle':
        return toggle(id)
      case 'radio':
        return setSelection((current) => {
          const next = new Set([...current].filter((x) => !tap.group.has(x)))
          if (!current.has(id)) next.add(id)
          return next
        })
      case 'pair':
        setPairs((current) => [...current, tap.pair])
        return setSelection(new Set())
      case 'cast': {
        if (pending?.kind !== 'announce_spells' || aiming === null) return
        const castable = pending.castable.find((c) => c.spell.id === aiming.spell)
        const element = aiming.element ?? castable?.elements[0]
        if (castable === undefined || element === undefined) return
        setCasts((current) => [
          ...stageCast(pending.castable, current, {
            spell: aiming.spell,
            element,
            count: tap.count,
            target: tap.target,
          }),
        ])
        return setAiming(null)
      }
    }
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
  // Which dice a tap reaches, wherever they are drawn (Phase 9f). It reads the drafts,
  // because a promotion's partners light up only once the die growing into them is picked.
  const asked = useMemo(
    () => pickModeFor(state, pending, human, selection, pairs, aiming),
    [state, pending, human, selection, pairs, aiming],
  )
  // Looking suspends selecting everywhere: every tile becomes a way to open its faces.
  const selectMode = looking ? null : asked

  // Read off the dice rather than the setup: a force may have been rolled, in which
  // case there is no preset id to look up, and the units know anyway. A list, since
  // v2 Phase 1: a force is the species its dice belong to, and it may hold several.
  const speciesOfForce = (player: PlayerId) =>
    forceSpecies(state, player).flatMap((id) => speciesInfo(id) ?? [])
  const mySpecies = speciesOfForce(human)
  const theirSpecies = speciesOfForce(enemy)

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
    selectMode?.side === 'reserve' ||
    selectMode?.side === 'any' ||
    (selectMode?.side === 'mine' && selectMode.slot === 'reserve')

  // Or a `sai_target` -- Flame, Bullseye, Seize -- can aim at the *enemy's*
  // Reserve Army, which nothing before Tower ever needed to show at all.
  const theirReserveSelectable =
    selectMode?.side === 'any' || (selectMode?.side === 'theirs' && selectMode.slot === 'reserve')
  const theirReserve = livingUnits(state, enemy).filter((u) => u.location.kind === 'reserve')
  // Dragons waiting in each Summoning Pool (Phase 9e). Only a `Summon Dragon` brings one
  // out, so which colours are still in a pool is what the spell is choosing among.
  const myPool = pooledDragons(state, human)
  const theirPool = pooledDragons(state, enemy)

  const myFallen = deadUnits(state, human)
  const theirFallen = deadUnits(state, enemy)
  // Shown in the same disclosure as the fallen, and labelled apart from them: the
  // DUA is a resource units come back out of, the BUA is where they stop. Nothing
  // buries until Phase 4, so these two are empty in every game today.
  const myBuried = buriedUnits(state, human)
  const theirBuried = buriedUnits(state, enemy)
  const anyBuried = myBuried.length > 0 || theirBuried.length > 0
  // Accelerated Growth sits on a player's DUA, and is live whether or not anybody is
  // in it yet -- so it opens the section on its own, and stays outside the collapse.
  const myDuaEffects = effectsOnPlayer(state, human, human)
  const theirDuaEffects = effectsOnPlayer(state, enemy, human)
  const anyDuaEffect = myDuaEffects.length > 0 || theirDuaEffects.length > 0

  // Accelerated Growth's question (Phase 9b) is about dice already in your DUA, so the
  // Fallen section is where it is answered, and it opens itself. The DUA splits in three
  // rows -- the dying dice, the small ones that could come back, and the rest -- and the
  // first two are selectable, so both halves of the answer are tapped in one place.
  const growth = asked?.side === 'dua' && pending?.kind === 'accelerated_growth' ? pending : null
  const dyingIds = new Set(growth?.dying ?? [])
  const partnerIds = new Set(growth?.partners ?? [])
  const dying = myFallen.filter((unit) => dyingIds.has(unit.id))
  const partners = myFallen.filter((unit) => partnerIds.has(unit.id))
  const longDead = myFallen.filter((unit) => !dyingIds.has(unit.id) && !partnerIds.has(unit.id))
  // A decision that picks from the DUA -- a promotion's partner, a recruit, a burial, a
  // Resurrect Dead -- opens the Fallen section itself, the way Accelerated Growth does.
  const picksDead =
    selectMode?.side === 'any' && myFallen.some((unit) => selectMode.only?.has(unit.id) === true)
  const fallenOpen = showFallen || growth !== null || picksDead

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
              : state.turn.phase === 'setup'
                ? 'roll-off'
                : state.turn.marching === human
                ? 'your march'
                : 'enemy march'}{' '}
            · vs {opponent} · seed {seed}
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
          onToggleFaces={(slot) =>
            setInspect((open) => (open?.kind === 'terrain' && open.slot === slot ? null : { kind: 'terrain', slot }))
          }
          selectMode={selectMode}
          selected={selection}
          onToggle={onTap}
          inspecting={inspecting}
          onInspect={onInspect}
          mySpecies={mySpecies}
          theirSpecies={theirSpecies}
        />

        {/* Everything in play that is not at a terrain (Phase 9e): both Reserve Armies
            and both Summoning Pools. The enemy's reserve used to appear only while an
            SAI was aimed at it, and the pools nowhere -- so a Reserve Army able to march
            and cast, and the dragons a Summon Dragon could bring, were invisible. */}
        {(reserveShown.length > 0 ||
          theirReserve.length > 0 ||
          mineReserveSelectable ||
          myPool.length > 0 ||
          theirPool.length > 0) && (
          <section className="army off-board">
            <h3>Reserves</h3>
            <p className="fallen-side muted">
              Enemy {theirReserve.length}d / {health(theirReserve)}h
            </p>
            <DiceGrid
              units={theirReserve}
              selectable={theirReserveSelectable}
              only={selectMode?.only}
              selected={selection}
              onToggle={onTap}
              inspecting={inspecting}
              onInspect={onInspect}
            />
            <p className="fallen-side muted">
              Yours {reserveShown.length}d / {health(reserveShown)}h
              {plan !== null && plan.moves.length > 0 ? ' still to place' : ''}
            </p>
            <DiceGrid
              units={reserveShown}
              selectable={mineReserveSelectable}
              only={selectMode?.only}
              selected={selection}
              onToggle={onTap}
              inspecting={inspecting}
              onInspect={onInspect}
            />
            {(myPool.length > 0 || theirPool.length > 0) && (
              <>
                <h3 className="pool-head">Summoning pools</h3>
                <p className="fallen-side muted">Enemy</p>
                {theirPool.length === 0 ? (
                  <p className="empty">empty</p>
                ) : (
                  <DragonRow dragons={theirPool} human={human} inspecting={inspecting} onInspect={onInspect} inPool />
                )}
                <p className="fallen-side muted">Yours</p>
                {myPool.length === 0 ? (
                  <p className="empty">empty</p>
                ) : (
                  <DragonRow dragons={myPool} human={human} inspecting={inspecting} onInspect={onInspect} inPool />
                )}
              </>
            )}
          </section>
        )}

        {(myFallen.length > 0 || theirFallen.length > 0 || anyBuried || anyDuaEffect) && (
          <section className="army off-board">
            <h3>
              <button
                type="button"
                className="fallen-toggle"

                onClick={() => setShowFallen((v) => !v)}
              >
                {fallenOpen ? '▾' : '▸'} Fallen
                <span className="muted">
                  {' '}
                  you {myFallen.length} · enemy {theirFallen.length}
                  {anyBuried ? ` · buried ${myBuried.length}/${theirBuried.length}` : ''}
                </span>
              </button>
            </h3>
            {myDuaEffects.length > 0 && (
              <>
                <p className="fallen-side muted">Your DUA</p>
                <EffectList effects={myDuaEffects} />
              </>
            )}
            {theirDuaEffects.length > 0 && (
              <>
                <p className="fallen-side muted">Enemy DUA</p>
                <EffectList effects={theirDuaEffects} />
              </>
            )}
            {fallenOpen && (
              <div className="fallen">
                {growth !== null && (
                  <>
                    <p className="fallen-side">Dying — tap the ones to save</p>
                    <DiceGrid
                      units={dying}
                      selectable={!looking}
                      selected={selection}
                      onToggle={toggle}
                      inspecting={inspecting}
                      onInspect={onInspect}
                    />
                    <p className="fallen-side">Can come back — tap as many as you save</p>
                    <DiceGrid
                      units={partners}
                      selectable={!looking}
                      selected={selection}
                      onToggle={toggle}
                      inspecting={inspecting}
                      onInspect={onInspect}
                    />
                  </>
                )}
                <p className="fallen-side muted">{growth === null ? 'Yours' : 'Yours, the rest'}</p>
                <DiceGrid
                  units={longDead}
                  selectable={picksDead}
                  only={selectMode?.only}
                  selected={selection}
                  onToggle={onTap}
                  inspecting={inspecting}
                  onInspect={onInspect}
                />
                <p className="fallen-side muted">Enemy</p>
                <DiceGrid units={theirFallen} inspecting={inspecting} onInspect={onInspect} />
                {myBuried.length > 0 && (
                  <>
                    <p className="fallen-side muted">Yours, buried</p>
                    <DiceGrid units={myBuried} inspecting={inspecting} onInspect={onInspect} />
                  </>
                )}
                {theirBuried.length > 0 && (
                  <>
                    <p className="fallen-side muted">Enemy, buried</p>
                    <DiceGrid units={theirBuried} inspecting={inspecting} onInspect={onInspect} />
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
          setCasts((current) =>
            pending?.kind === 'announce_spells'
              ? [...stageCast(pending.castable, current, cast)]
              : current,
          )
        }
        onStage={(moves) => setStaged((current) => [...current, ...moves])}
        onCount={count}
        onToggle={toggle}
        onClearSelection={() => setSelection(new Set())}
        onClearDraft={clearDraft}
        dispatch={dispatch}
        looking={looking}
        onLook={setLooking}
        onInspect={onInspect}
      />

      {inspect !== null && <Inspector target={inspect} state={state} onClose={closeInspector} />}

    </div>
  )
}
