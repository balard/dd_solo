/**
 * The run's screens between battles (v3 Phase 4b), from `run.pending` and nothing else:
 * the race pick, the force before a battle, the reward of five, an event, and the run's
 * end. Laid out by `docs/mockups/v3-phase-4a.html`; every rule they show is `src/run/`'s
 * or `runView.ts`'s, and every die is drawn with the board's own components.
 *
 * The force before a battle is the army builder over the run's pool (4c), under the next
 * enemy.
 */
import { useCallback, useState, type ReactNode } from 'react'

import { dragonDie, ownTerrainType, speciesElements, terrainDieName, unitType } from '../../data/load'
import { PRESET_ARMY_NAMES, type PresetArmyName } from '../../data/presets'
import type { BuiltForce } from '../../engine/force'
import { forceHealth, forceProblems, used } from '../../engine/forceProblems'
import { PLAYABLE_SPECIES, PLAYABLE_UNITS } from '../../engine/playable'
import { ABILITY_TEXT, SPECIES_ABILITIES } from '../../engine/species'
import { V1_RULES } from '../../engine/types'
import { suggestForce } from '../../run/autopilot'
import { enemyForce } from '../../run/battle'
import { transformsOf } from '../../run/draws'
import { upgradePreview } from '../../run/reduce'
import { ACT_SIZE, type Offer, type RunState } from '../../run/types'

import { ForceEditor } from '../game/ArmyBuilder'
import { DragonDetail, DragonTileBody, TerrainDetail } from '../game/Board'
import { FaceSheet, UnitDetail, UnitTileBody, describe } from '../game/DiceGrid'
import { ElementDots } from '../game/Elements'
import { InspectorPanel } from '../game/Inspector'
import { readSeed } from '../game/newGame'
import { compareForDisplay } from '../game/prompts'
import { tileSize } from '../game/stacks'
import { newSeed } from '../game/useGame'
import { RuleSetProvider } from '../game/useRuleSet'

import {
  ROMAN,
  actStrip,
  dragonNote,
  entryWhere,
  eventResult,
  freshDice,
  offerText,
  outcomeText,
  runName,
  runStats,
  runWhere,
  speciesName,
  type EventResult,
} from './runView'
import type { RunApi } from './useRun'

type Looking = { readonly kind: 'unit'; readonly typeId: string } | { readonly kind: 'dragon'; readonly dieId: string } | { readonly kind: 'terrain'; readonly dieId: string }

const ARMY_NAME: Readonly<Record<PresetArmyName, string>> = { home: 'Home', campaign: 'Campaign', horde: 'Horde' }
/** Where each army starts a battle, said from the player's side: the enemy's Home army
 *  stands on their Home, and their Horde on yours. */
const ARMY_WHERE: Readonly<Record<'yours' | 'theirs', Readonly<Record<PresetArmyName, string>>>> = {
  yours: { home: 'your Home', campaign: 'the Frontier', horde: 'their Home' },
  theirs: { home: 'their Home', campaign: 'the Frontier', horde: 'your Home' },
}

/** One side's three armies, each with its health, where it starts, and its dice. */
function ArmiesView({ force, side, onLook }: { force: BuiltForce; side: 'yours' | 'theirs'; onLook: (looking: Looking) => void }) {
  const health = (ids: readonly string[]) => ids.reduce((n, id) => n + unitType(id).health, 0)
  return (
    <div className="run-armies">
      {PRESET_ARMY_NAMES.map((army) => (
        <div key={army} className="run-army">
          <div className="run-army-head">
            <span>
              <b>{ARMY_NAME[army]}</b> <span className="muted">at {ARMY_WHERE[side][army]}</span>
            </span>
            <span className="muted">{health(force.armies[army])} health</span>
          </div>
          <div className="dice-grid run-dice">
            {[...force.armies[army]]
              .sort((a, b) => compareForDisplay(unitType(a), unitType(b)))
              .map((id, i) => (
                <UnitButton key={i} typeId={id} label="look" onClick={() => onLook({ kind: 'unit', typeId: id })} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A dragon die as a button that opens its faces. */
function DragonLook({ dieId, note, onLook }: { dieId: string; note: string; onLook: (looking: Looking) => void }) {
  return (
    <button
      type="button"
      className={`dragon-tile dragon-el-${dragonDie(dieId).element}`}
      onClick={() => onLook({ kind: 'dragon', dieId })}
      title={`${dragonNameOf(dieId)} — ${note}`}
    >
      <DragonTileBody dieId={dieId} />
    </button>
  )
}

/** A terrain die by name, as a link that opens its eight faces. */
function TerrainLook({ dieId, note, onLook }: { dieId: string; note: string; onLook: (looking: Looking) => void }) {
  return (
    <button type="button" className="link-button" onClick={() => onLook({ kind: 'terrain', dieId })}>
      {terrainDieName(dieId)}
      {note === '' ? '' : ` (${note})`}
    </button>
  )
}

const allDice = (force: BuiltForce): readonly string[] => PRESET_ARMY_NAMES.flatMap((a) => force.armies[a])

/** A unit die as a button: the board's tile, at the board's size. */
function UnitButton({
  typeId,
  onClick,
  picked = false,
  isNew = false,
  label,
}: {
  typeId: string
  onClick: () => void
  picked?: boolean
  isNew?: boolean
  label: string
}) {
  const side = tileSize(typeId, false)
  const title = `${describe(unitType(typeId))} — ${label}`
  return (
    <div className={`die-wrap run-die${isNew ? ' is-new' : ''}`}>
      <button
        type="button"
        className={`die die-squared die-selectable${picked ? ' die-selected' : ''}`}
        style={{ width: side, height: side }}
        onClick={onClick}
        aria-pressed={picked}
        title={title}
        aria-label={title}
      >
        <UnitTileBody typeId={typeId} />
      </button>
    </div>
  )
}

/** The three acts: where the run is and what is left. The current act alone on a narrow
 *  or short screen (CSS), a line and twelve pips. */
export function ActStrip({ run }: { run: RunState }) {
  return (
    <div className="act-strip" aria-label={`${runName(run)}, ${runWhere(run)}`}>
      {actStrip(run).map((act) => (
        <div key={act.act} className={`act act-${act.state}`}>
          <div className="act-name">
            Act {ROMAN[act.act]}{' '}
            <span className="muted">
              {act.state === 'now' && run.status === 'playing'
                ? `cap ${act.cap} · encounter ${run.encounter + 1} of 12`
                : act.state === 'done'
                  ? 'cleared'
                  : `cap ${act.cap}`}
            </span>
          </div>
          <div className="act-slots">
            {act.slots.map((slot, i) => (
              <span key={i} className={`act-slot is-${slot}`} title={`Encounter ${i + 1}: ${slot}`}>
                {slot === 'won' ? '✓' : slot === 'lost' ? '✗' : slot === 'here' ? i + 1 : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A run screen: the strip, a scrolling page, and a footer that never scrolls. */
function Frame({ run, children, foot }: { run: RunState | null; children: ReactNode; foot: ReactNode }) {
  return (
    <div className="app run-app">
      <div className="run-page">
        {run !== null && <ActStrip run={run} />}
        {children}
      </div>
      <div className="run-foot">{foot}</div>
    </div>
  )
}

// --- the race pick ------------------------------------------------------------------

/** Where a race's Home Terrain comes from, in words. */
function homeWords(species: string): string {
  const own = ownTerrainType(species)
  if (own !== null) return `home on ${own.name}`
  const elements = speciesElements(species).filter((e) => e !== 'death')
  return `home on any ${elements.join(' or ')} terrain`
}

export function RacePick({ onStart, onBack }: { onStart: (race: string, seed: number) => void; onBack: () => void }) {
  const [race, setRace] = useState<string>(PLAYABLE_SPECIES[0]?.id ?? 'treefolk')
  const [seedText, setSeedText] = useState('')
  const seed = readSeed(seedText)
  return (
    <Frame
      run={null}
      foot={
        <>
          <span className="run-foot-why">{seed.kind === 'bad' ? seed.problem : `${speciesName(race)} · ${homeWords(race)}`}</span>
          <button type="button" className="choice secondary" onClick={onBack}>
            Back
          </button>
          <button
            type="button"
            className="choice"
            disabled={seed.kind === 'bad'}
            onClick={() => seed.kind !== 'bad' && onStart(race, seed.kind === 'fixed' ? seed.seed : newSeed())}
          >
            Start a {speciesName(race)} run
          </button>
        </>
      }
    >
      <div>
        <h1 className="run-title">Pick a race</h1>
        <p className="muted run-lede">
          You start with one large die, a medium die of its line and one more, the race&rsquo;s five small dice, a
          dragon and two terrains: 12 health, drawn from the seed.
        </p>
      </div>
      <div className="race-grid" role="radiogroup" aria-label="Race">
        {PLAYABLE_SPECIES.map((species) => {
          const dice = ['large', 'medium', 'small'].flatMap((size) => sampleDie(species.id, size) ?? [])
          return (
            <button
              key={species.id}
              type="button"
              role="radio"
              aria-checked={race === species.id}
              className={`race-card${race === species.id ? ' is-picked' : ''}`}
              onClick={() => setRace(species.id)}
            >
              <span className="race-name">
                <ElementDots elements={species.elements} />
                {species.name}
              </span>
              <span className="muted">
                {species.elements.join(' & ')} · {homeWords(species.id)}
              </span>
              <span className="race-abilities">
                {(SPECIES_ABILITIES[species.id] ?? []).map((ability) => (
                  <span key={ability} title={ABILITY_TEXT[ability]}>
                    {ability}
                  </span>
                ))}
              </span>
              <span className="race-dice" aria-hidden="true">
                {dice.map((typeId) => (
                  <span key={typeId} className="die die-squared" style={{ width: tileSize(typeId, true), height: tileSize(typeId, true) }}>
                    <UnitTileBody typeId={typeId} compact />
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>
      <label className="new-game-field run-seed">
        <span className="new-game-label">Seed</span>
        <input value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder="leave empty to roll one" inputMode="numeric" />
      </label>
    </Frame>
  )
}

/** The race's first die of a size, in the board's display order: what its card shows. */
function sampleDie(species: string, size: string): string | null {
  return [...PLAYABLE_UNITS].filter((u) => u.species === species && u.size === size).sort(compareForDisplay)[0]?.id ?? null
}

// --- the force before a battle -------------------------------------------------------------

/** A phone held sideways, or any screen too short to spare the lines (4a): the folds start shut. */
const isShort = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-height: 499px)').matches

/**
 * The force before a battle (v3 Phase 4c): the next enemy, then the army builder over the
 * run's pool and the act's cap. The run's own `force` is the draft -- every edit is a
 * `set_force` -- so there is no second copy to fall out of step, and a reload comes back to
 * the force as it was left. Fight is refused while `forceProblems` finds anything, under the
 * run's dragon rule; each problem sits beside its section, and the first beside Fight.
 */
function ArrangeScreen({ api, run, onFight }: { api: RunApi; run: RunState; onFight: () => void }) {
  const [short] = useState(isShort)
  const [looking, setLooking] = useState<Looking | null>(null)
  if (run.pending.kind !== 'arrange_force' || run.current?.kind !== 'battle') return null
  const cap = run.pending.cap
  const enemy = enemyForce(run)
  const problems = forceProblems(run.collection, cap, run.force, 'at_most')
  const total = forceHealth(run.force)
  const suggested = suggestForce(run, cap)
  const better = suggested !== null && JSON.stringify(suggested) !== JSON.stringify(run.force)
  return (
    <Frame
      run={run}
      foot={
        <>
          <span className={`run-foot-why${problems.length > 0 ? ' is-bad' : ''}`}>
            {problems[0]?.text ?? `${total} / ${cap} health · ${(run.force.dragons ?? []).map(dragonNameOf).join(', ')}`}
          </span>
          <button type="button" className="choice secondary" onClick={api.leave}>
            Leave run
          </button>
          <button type="button" className="choice" disabled={problems.length > 0} onClick={onFight}>
            Fight {run.current.name}
          </button>
        </>
      }
    >
      <section className="run-panel">
        <p className="run-label">Next battle · {runWhere(run)}</p>
        <h2 className="run-h2">{run.current.name}</h2>
        <p className="muted">
          They field {speciesList(enemy)}, {forceHealth(enemy)} health in {allDice(enemy).length} dice, played by{' '}
          {run.current.opponent}. You field {total} of {cap}.
        </p>
        {/* Their force whole (playtest, 2026-10-09): the armies as they will stand, their
            Home, the Frontier they will propose, and their dragons -- all fixed when the
            encounter is drawn (`enemyForce`), so what is shown is what is played. */}
        <details className="run-enemy" open={!short}>
          <summary>Their force</summary>
          <ArmiesView force={enemy} side="theirs" onLook={setLooking} />
          <div className="run-enemy-extras">
            <p className="run-terrains">
              <span className="muted">Home</span>
              {enemy.homeTerrain !== undefined && <TerrainLook dieId={enemy.homeTerrain} note="" onLook={setLooking} />}
              <span className="muted">Frontier proposal</span>
              {enemy.frontierProposal !== undefined && (
                <TerrainLook dieId={enemy.frontierProposal} note="" onLook={setLooking} />
              )}
            </p>
            <div className="run-enemy-dragons">
              <span className="muted">Dragons</span>
              {(enemy.dragons ?? []).map((id, i) => (
                <DragonLook key={i} dieId={id} note="theirs" onLook={setLooking} />
              ))}
            </div>
          </div>
        </details>
      </section>
      <div className="run-force-head">
        <p className="run-label">Your force</p>
        <button
          type="button"
          className="choice secondary"
          disabled={!better}
          onClick={() => suggested !== null && api.dispatch({ kind: 'set_force', force: suggested })}
          title="As much of your pool as fits under the cap, split legally, with your terrains and dragons"
        >
          Fill from your pool
        </button>
      </div>
      <ForceEditor
        collection={run.collection}
        cap={cap}
        force={run.force}
        onChange={(force) => api.dispatch({ kind: 'set_force', force })}
        dragons="at_most"
        fresh={freshDice(run)}
        foldExtras
        foldedAtFirst={short}
      />
      {looking !== null && <Inspect looking={looking} onClose={() => setLooking(null)} />}
    </Frame>
  )
}

const dragonNameOf = (dieId: string): string => {
  const die = dragonDie(dieId)
  return `${die.element[0]?.toUpperCase() ?? ''}${die.element.slice(1)} ${die.form === 'drake' ? 'Drake' : 'Wyrm'}`
}

const speciesList = (force: BuiltForce): string =>
  [...new Set(allDice(force).map((id) => speciesName(unitType(id).species)))].join(' and ')

// --- the reward ------------------------------------------------------------------------

function OfferCard({ offer, run, picked, onPick, onLook }: { offer: Offer; run: RunState; picked: boolean; onPick: () => void; onLook: () => void }) {
  const text = offerText(offer, run.race)
  return (
    <div className={`offer${picked ? ' is-picked' : ''}`}>
      <div className="offer-die">
        {offer.kind === 'unit' && <UnitButton typeId={offer.id} label="look" onClick={onLook} />}
        {offer.kind === 'dragon' && (
          <button type="button" className={`dragon-tile dragon-el-${dragonDie(offer.id).element}`} onClick={onLook} title={`${text.name} — look`}>
            <DragonTileBody dieId={offer.id} />
          </button>
        )}
      </div>
      <button type="button" className="offer-pick" onClick={onPick} aria-pressed={picked}>
        <span className="run-label">{text.kind}</span>
        <b className="offer-name">{text.name}</b>
        <span className="muted">{text.detail}</span>
        {offer.kind === 'dragon' && <span className="offer-why">{dragonNote(run)}</span>}
      </button>
      {offer.kind === 'unit' && <FaceSheet typeId={offer.id} faces={unitType(offer.id).faces} size={30} />}
      {offer.kind === 'terrain' && <TerrainDetail terrain={{ dieId: offer.id }} />}
    </div>
  )
}

/**
 * What the player holds, read-only (playtest, 2026-10-08): the force as fielded, army by
 * army, then what the pool holds beside it. Shown on the reward behind a button, so an
 * offer can be judged against the dice it would join.
 */
function ForceAndPool({ run, onLook }: { run: RunState; onLook: (looking: Looking) => void }) {
  const force = run.force
  const spare = Object.entries(run.collection.units)
    .flatMap(([id, n]) => Array<string>(Math.max(0, n - used(force, 'units', id))).fill(id))
    .sort((a, b) => compareForDisplay(unitType(a), unitType(b)))
  const owned = (counts: Readonly<Record<string, number>>) =>
    Object.entries(counts).flatMap(([id, n]) => Array<string>(Math.max(0, n)).fill(id)).sort()
  const dragons = owned(run.collection.dragons)
  const terrains = owned(run.collection.terrains)
  const fielded = new Set(force.dragons ?? [])
  const units = (ids: readonly string[], key: string) =>
    [...ids]
      .sort((a, b) => compareForDisplay(unitType(a), unitType(b)))
      .map((id, i) => <UnitButton key={`${key}${i}`} typeId={id} label="look" onClick={() => onLook({ kind: 'unit', typeId: id })} />)
  return (
    <section className="run-panel run-holdings" aria-label="Your force and pool">
      <p className="run-label">
        Your force · {forceHealth(force)} of {ACT_SIZE[run.act]} health
      </p>
      <ArmiesView force={force} side="yours" onLook={onLook} />
      <p className="run-label">In your pool, not fielded</p>
      <div className="dice-grid run-dice">
        {spare.length === 0 ? <p className="empty">Every die you own is fielded.</p> : units(spare, 's')}
      </div>
      <p className="run-label">Dragons</p>
      <div className="dice-grid run-dice">
        {dragons.map((id, i) => (
          <DragonLook key={i} dieId={id} note={fielded.has(id) ? 'fielded' : 'in your pool'} onLook={onLook} />
        ))}
      </div>
      <p className="run-label">Terrains</p>
      <p className="run-terrains">
        {terrains.map((id, i) => (
          <TerrainLook
            key={i}
            dieId={id}
            note={id === force.homeTerrain ? 'Home' : id === force.frontierProposal ? 'Frontier proposal' : ''}
            onLook={onLook}
          />
        ))}
      </p>
    </section>
  )
}

function RewardScreen({ api, run }: { api: RunApi; run: RunState }) {
  const [picked, setPicked] = useState<number | null>(null)
  const [looking, setLooking] = useState<Looking | null>(null)
  const [holdings, setHoldings] = useState(false)
  if (run.pending.kind !== 'reward') return null
  const offers = run.pending.offers
  const choice = picked === null ? undefined : offers[picked]
  return (
    <Frame
      run={run}
      foot={
        <>
          <span className="run-foot-why">{choice === undefined ? 'Pick one of the five.' : offerText(choice, run.race).detail}</span>
          <button
            type="button"
            className="choice"
            disabled={picked === null}
            onClick={() => picked !== null && api.dispatch({ kind: 'take_offer', index: picked })}
          >
            {choice === undefined ? 'Take' : `Take ${offerText(choice, run.race).name}`}
          </button>
        </>
      }
    >
      <div>
        <h1 className="run-title">{run.current?.name ?? 'The battle'} is beaten. Pick a reward.</h1>
        <p className="muted run-lede">It goes to your pool; you field it before the next battle. Tap a die to look at it.</p>
        <button
          type="button"
          className="choice secondary run-holdings-toggle"
          aria-expanded={holdings}
          onClick={() => setHoldings((open) => !open)}
        >
          {holdings ? 'Hide your force and pool' : 'Show your force and pool'}
        </button>
      </div>
      {holdings && <ForceAndPool run={run} onLook={setLooking} />}
      <div className="offers">
        {offers.map((offer, i) => (
          <OfferCard
            key={i}
            offer={offer}
            run={run}
            picked={picked === i}
            onPick={() => setPicked(i)}
            onLook={() =>
              setLooking(offer.kind === 'unit' ? { kind: 'unit', typeId: offer.id } : { kind: offer.kind, dieId: offer.id })
            }
          />
        ))}
      </div>
      {looking !== null && <Inspect looking={looking} onClose={() => setLooking(null)} />}
    </Frame>
  )
}

// --- the event --------------------------------------------------------------------------

/**
 * The event's answer, shown before the run moves on (playtest, 2026-10-09): the die as it
 * was and as it is, what that did to the force, and what comes next. Without it an upgrade
 * cut straight to the next encounter, and the change it made was easy to miss.
 */
function EventResultDialog({ result, onClose }: { result: EventResult; onClose: () => void }) {
  const close = useCallback(onClose, [onClose])
  // In a `div`: `.event-path > span` is the arrow's rule.
  const die = (id: string) => (
    <div className="die-wrap">
      <span className="die die-squared" style={{ width: tileSize(id, false), height: tileSize(id, false) }} title={describe(unitType(id))}>
        <UnitTileBody typeId={id} />
      </span>
    </div>
  )
  return (
    <InspectorPanel onClose={close}>
      <div className="event-result" aria-live="polite">
        <p className="run-label">{result.kind === 'upgrade' ? 'Upgraded' : 'Transformed'}</p>
        <h2 className="run-h2">{result.title}</h2>
        <div className="event-path">
          {die(result.from)}
          <span aria-hidden="true">→</span>
          {die(result.to)}
        </div>
        <p>{result.force}</p>
        {result.next !== '' && <p className="muted">{result.next}</p>}
        <div className="choices">
          <button type="button" className="choice" onClick={close} autoFocus>
            Continue
          </button>
        </div>
      </div>
    </InspectorPanel>
  )
}

function EventScreen({ api, run, onChange }: { api: RunApi; run: RunState; onChange: () => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [looking, setLooking] = useState<Looking | null>(null)
  if (run.pending.kind !== 'event') return null
  const pending = run.pending
  const fielded = [...allDice(run.force)].sort((a, b) => compareForDisplay(unitType(a), unitType(b)))
  const spare = Object.entries(run.collection.units)
    .flatMap(([id, n]) => Array<string>(Math.max(0, n - used(run.force, 'units', id))).fill(id))
    .sort((a, b) => compareForDisplay(unitType(a), unitType(b)))
  const preview = picked === null ? null : upgradePreview(run, picked)
  const into = picked === null ? [] : transformsOf(picked)
  const name = (id: string) => unitType(id).name

  const upgradeNote = (): string => {
    if (picked === null) return 'Pick a die first.'
    if (preview === null) return `${name(picked)} is the top of its line.`
    switch (preview.effect) {
      case 'pool':
        return `You hold a spare ${name(picked)}: that copy changes, and your force does not.`
      case 'in_place':
        return `${name(preview.to)} takes its place in the ${preview.army === null ? 'force' : ARMY_NAME[preview.army]}: ${forceHealth(preview.force)} of ${ACT_SIZE[run.act]} health.`
      case 'benched': {
        const total = forceHealth(run.force) + unitType(preview.to).health - unitType(picked).health
        const why =
          total > ACT_SIZE[run.act]
            ? `it would make your force ${total} health, over the cap of ${ACT_SIZE[run.act]}`
            : `its army would hold more than half your force`
        return `${name(preview.to)} does not fit where ${name(picked)} stands: ${why}. It leaves the force and waits in your pool until you field it.`
      }
    }
  }
  const tile = (id: string, i: number, isSpare: boolean) => (
    <UnitButton key={`${isSpare ? 's' : 'f'}${i}`} typeId={id} picked={picked === id} label="pick" onClick={() => setPicked(id)} />
  )

  return (
    <Frame
      run={run}
      foot={
        <>
          <span className="run-foot-why">{picked === null ? 'Pick a die from your pool, or walk on.' : name(picked)}</span>
          <button type="button" className="choice secondary" onClick={() => api.dispatch({ kind: 'skip' })}>
            Walk on
          </button>
          {/* Upgrade and Transform weigh the same (playtest, 2026-10-08): neither is the
              answer the screen recommends, so both are primary. */}
          <button
            type="button"
            className="choice"
            disabled={picked === null || !pending.transformable.includes(picked)}
            onClick={() => {
              if (picked === null) return
              onChange()
              api.dispatch({ kind: 'transform', unit: picked })
            }}
          >
            {picked === null || !pending.transformable.includes(picked) ? 'Transform' : `Transform ${name(picked)}`}
          </button>
          <button
            type="button"
            className="choice"
            disabled={picked === null || preview === null}
            onClick={() => {
              if (picked === null) return
              onChange()
              api.dispatch({ kind: 'upgrade', unit: picked })
            }}
          >
            {preview === null ? 'Upgrade' : `Upgrade to ${name(preview.to)}`}
          </button>
        </>
      }
    >
      <div>
        <h1 className="run-title">{pending.encounter.name}</h1>
        <p className="muted run-lede">Change one die in your pool, or walk on.</p>
      </div>
      <section className="run-panel">
        <p className="run-label">Fielded</p>
        <div className="dice-grid run-dice">{fielded.map((id, i) => tile(id, i, false))}</div>
        <p className="run-label">Spare</p>
        <div className="dice-grid run-dice">{spare.length === 0 ? <p className="empty">Every die you own is fielded.</p> : spare.map((id, i) => tile(id, i, true))}</div>
        {picked !== null && (
          <button type="button" className="link-button" onClick={() => setLooking({ kind: 'unit', typeId: picked })}>
            Look at {name(picked)}
          </button>
        )}
      </section>
      <div className="event-choices">
        <section className="run-panel">
          <h2 className="run-h3">Upgrade</h2>
          {picked !== null && preview !== null && (
            <div className="event-path">
              <UnitButton typeId={picked} label="look" onClick={() => setLooking({ kind: 'unit', typeId: picked })} />
              <span aria-hidden="true">→</span>
              <UnitButton typeId={preview.to} label="look" onClick={() => setLooking({ kind: 'unit', typeId: preview.to })} />
            </div>
          )}
          <p className={`run-note${preview?.effect === 'benched' ? ' is-warn' : ''}`}>{upgradeNote()}</p>
        </section>
        <section className="run-panel">
          <h2 className="run-h3">Transform</h2>
          {picked !== null && (
            <div className="event-path">
              <UnitButton typeId={picked} label="look" onClick={() => setLooking({ kind: 'unit', typeId: picked })} />
              <span aria-hidden="true">→</span>
              {into.map((id) => (
                <UnitButton key={id} typeId={id} label="look" onClick={() => setLooking({ kind: 'unit', typeId: id })} />
              ))}
            </div>
          )}
          <p className="run-note">
            {picked === null ? 'Pick a die first.' : 'One of these, at random: the same species and health.'}
          </p>
        </section>
      </div>
      {looking !== null && <Inspect looking={looking} onClose={() => setLooking(null)} />}
    </Frame>
  )
}

// --- the run's end ------------------------------------------------------------------------

function RunEnd({ api, run, onNewRun }: { api: RunApi; run: RunState; onNewRun: () => void }) {
  const stats = runStats(run)
  const won = run.status === 'won'
  const lastLost = [...run.history].reverse().find((h) => h.outcome.kind === 'lost')
  return (
    <Frame
      run={run}
      foot={
        <>
          <span className="run-foot-why">Seen once: the save is cleared when you leave this page.</span>
          <button type="button" className="choice secondary" onClick={api.close}>
            Back to start
          </button>
          <button type="button" className="choice" onClick={onNewRun}>
            New run
          </button>
        </>
      }
    >
      <div>
        <h1 className={`run-title ${won ? 'is-won' : 'is-lost'}`}>{won ? 'The run is won.' : 'The run is lost.'}</h1>
        <p className="muted run-lede">
          {won
            ? `${runName(run)}, all three acts cleared · seed ${run.seed}`
            : `${runName(run)}, lost at ${runWhere(run)}${lastLost === undefined ? '' : `, to ${lastLost.name}`} · seed ${run.seed}`}
        </p>
      </div>
      <div className="run-stats">
        <div><b>{stats.battlesWon}</b><span>battles won</span></div>
        <div><b>{stats.events}</b><span>events</span></div>
        <div><b>{stats.poolHealth}</b><span>health in your pool</span></div>
        <div><b>{stats.dragons}</b><span>dragons</span></div>
      </div>
      <section className="run-panel">
        <p className="run-label">The force at the end · {stats.fielded} health</p>
        <div className="dice-grid run-dice">
          {allDice(run.force).map((id, i) => (
            <span key={i} className="die die-squared" style={{ width: tileSize(id, false), height: tileSize(id, false) }}>
              <UnitTileBody typeId={id} />
            </span>
          ))}
        </div>
      </section>
      <section className="run-panel">
        <p className="run-label">Encounter by encounter</p>
        <ol className="run-history">
          {run.history.map((entry, i) => (
            <li key={i} className={`is-${entry.outcome.kind}`}>
              <span className="muted">{entryWhere(entry)}</span>
              <span>{entry.name}</span>
              <span>{outcomeText(entry)}</span>
            </li>
          ))}
        </ol>
      </section>
    </Frame>
  )
}

// --- the inspector, and the fork ------------------------------------------------------------

function Inspect({ looking, onClose }: { looking: Looking; onClose: () => void }) {
  const close = useCallback(onClose, [onClose])
  return (
    <InspectorPanel onClose={close}>
      {looking.kind === 'unit' && <UnitDetail typeId={looking.typeId} />}
      {looking.kind === 'dragon' && <DragonDetail dieId={looking.dieId} whose={null} />}
      {looking.kind === 'terrain' && <TerrainDetail terrain={{ dieId: looking.dieId }} />}
    </InspectorPanel>
  )
}

/**
 * The run between battles, by its pending -- every kind, no default. A battle is `App`'s to
 * play; this draws only the moment before it starts, which a reload can land on.
 */
export function RunScreen({
  api,
  run,
  onFight,
  onStartBattle,
  onNewRun,
}: {
  api: RunApi
  run: RunState
  onFight: () => void
  onStartBattle: () => void
  onNewRun: () => void
}) {
  const pending = run.pending
  // The run as it stood before an upgrade or a transform, so the dialog can say what the
  // event did once the run has moved on to the next encounter (playtest, 2026-10-09).
  const [beforeEvent, setBeforeEvent] = useState<RunState | null>(null)
  const result = beforeEvent === null ? null : eventResult(beforeEvent, run)
  let screen: ReactNode
  switch (pending.kind) {
    case 'choose_race':
      screen = <RacePick onStart={api.begin} onBack={api.leave} />
      break
    case 'arrange_force':
      screen = <ArrangeScreen api={api} run={run} onFight={onFight} />
      break
    case 'battle':
      screen = (
        <Frame
          run={run}
          foot={
            <>
              <span className="run-foot-why">{pending.encounter.name}</span>
              <button type="button" className="choice" onClick={onStartBattle}>
                Start the battle
              </button>
            </>
          }
        >
          <h1 className="run-title">{pending.encounter.name}</h1>
        </Frame>
      )
      break
    case 'reward':
      screen = <RewardScreen api={api} run={run} />
      break
    case 'event':
      screen = <EventScreen api={api} run={run} onChange={() => setBeforeEvent(run)} />
      break
    case 'over':
      screen = <RunEnd api={api} run={run} onNewRun={onNewRun} />
      break
  }
  // Rule text on a face asks the rules being played (`useRuleSet`), and a run plays V1_RULES.
  return (
    <RuleSetProvider ruleSet={V1_RULES}>
      {screen}
      {result !== null && <EventResultDialog result={result} onClose={() => setBeforeEvent(null)} />}
    </RuleSetProvider>
  )
}
