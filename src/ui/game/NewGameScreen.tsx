/**
 * What the app opens on: pick the two forces, pick a seed, start.
 *
 * A full-page tree under `.app` rather than an overlay, following `ErrorBoundary`:
 * this project has no modal shell and should not grow one for a screen that is only
 * ever the whole window.
 *
 * Every rule it applies lives in `newGame.ts`, where it is testable without a DOM.
 * The component's only job is to show the problem instead of hiding the button --
 * a disabled Start with no reason next to it is the same bug as a crash, slower.
 *
 * A side is a preset or a force kept in the army builder, and the opponent's may be
 * rolled instead (v2 Phase 4c). The builder is a page of its own, reached from here
 * and returning here -- with the force it built already picked, when asked to.
 */
import { useEffect, useState, type ReactNode } from 'react'

import { DEFAULT_OPPONENT, type OpponentName } from '../../ai/opponents'
import type { ForcePool } from '../../engine/force'
import { forceHealth } from '../../engine/forceProblems'
import type { SetupOptions } from '../../engine/setup'

import { ArmyBuilder } from './ArmyBuilder'
import { defaultForceName } from './builder'
import { speciesInfo } from './Elements'
import { readSavedForces, type SavedForce } from './forceStore'
import { readText, writeText } from './prefs'
import {
  RANDOM_SIZES,
  newGameSetup,
  opponentChoices,
  parseSideValue,
  poolChoices,
  presetChoices,
  randomGameSetup,
  sideOptionGroups,
  sideValue,
  type OpponentSide,
  type SideChoice,
} from './newGame'
import { newSeed } from './useGame'

const CHOICES = presetChoices()
const OPPONENTS = opponentChoices()
const POOLS = poolChoices()

/** The lightest preset of that species, which is a monster fixture -- the board this
 *  screen was first built to make reachable, so it is the one it opens on. */
function defaultFor(species: string): SideChoice {
  const found = CHOICES.find((c) => c.species === species) ?? CHOICES[0]
  if (found === undefined) throw new Error('no presets are loaded, so there is nothing to start')
  return { kind: 'preset', id: found.id }
}

/** The line under a picker: what the chosen side is. */
function sideNote(side: SideChoice | { readonly kind: 'random' }, kept: readonly SavedForce[]): string {
  if (side.kind === 'random') return 'Rolled from the seed, at the size and from the dice below.'
  if (side.kind === 'preset') {
    const choice = CHOICES.find((c) => c.id === side.id)
    if (choice === undefined) return ''
    const species = speciesInfo(choice.species)?.name ?? choice.species
    return `${species} · ${choice.health} health · ${choice.split} dice across home, Frontier, enemy home`
  }
  const entry = kept.find((f) => f.id === side.id)
  if (entry === undefined) return ''
  const { home, campaign, horde } = entry.force.armies
  return (
    `${defaultForceName(entry.force)} · ${home.length} / ${campaign.length} / ${horde.length} ` +
    'dice across home, Frontier, enemy home'
  )
}

function SidePicker({
  label,
  side,
  kept,
  opponent,
  onChange,
}: {
  readonly label: string
  readonly side: SideChoice | { readonly kind: 'random' }
  readonly kept: readonly SavedForce[]
  readonly opponent: boolean
  readonly onChange: (side: SideChoice | { readonly kind: 'random' }) => void
}) {
  return (
    <label className="new-game-field">
      <span className="new-game-label">{label}</span>
      <select
        value={sideValue(side)}
        onChange={(e) => {
          const next = parseSideValue(e.target.value)
          if (next !== null) onChange(next)
        }}
      >
        {sideOptionGroups(kept, opponent).map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="new-game-note muted">{sideNote(side, kept)}</span>
    </label>
  )
}

/** A picked kept force that is no longer kept falls back to the default, rather than
 *  leaving the picker on a value none of its options has. */
function stillThere<T extends SideChoice | { readonly kind: 'random' }>(
  side: T,
  kept: readonly SavedForce[],
  fallback: SideChoice,
): T | SideChoice {
  return side.kind === 'kept' && !kept.some((f) => f.id === side.id) ? fallback : side
}

/** What the screen remembers between games: the last choices, as a per-viewer
 *  preference (not a save). Read defensively -- it is JSON a past version wrote. */
interface Remembered {
  p1?: SideChoice
  p2?: SideChoice | { kind: 'random' }
  randomSize?: 'same' | number
  randomPool?: string
  opponent?: OpponentName
  seedText?: string
}

const REMEMBER_KEY = 'newgame'

function readRemembered(kept: readonly SavedForce[]): Remembered {
  try {
    const raw = readText(REMEMBER_KEY)
    if (raw === null) return {}
    const r = JSON.parse(raw) as Record<string, unknown>
    const out: Remembered = {}
    const side = (v: unknown, allowRandom: boolean): SideChoice | { kind: 'random' } | undefined => {
      const o = v as { kind?: unknown; id?: unknown } | null
      if (o === null || typeof o !== 'object') return undefined
      if (allowRandom && o.kind === 'random') return { kind: 'random' }
      if (o.kind === 'preset' && CHOICES.some((c) => c.id === o.id)) return { kind: 'preset', id: o.id as string }
      if (o.kind === 'kept' && kept.some((f) => f.id === o.id)) return { kind: 'kept', id: o.id as string }
      return undefined
    }
    const p1 = side(r.p1, false)
    if (p1 !== undefined && p1.kind !== 'random') out.p1 = p1
    const p2 = side(r.p2, true)
    if (p2 !== undefined) out.p2 = p2
    if (r.randomSize === 'same' || RANDOM_SIZES.some((n) => n === r.randomSize)) out.randomSize = r.randomSize as 'same' | number
    if (typeof r.randomPool === 'string' && POOLS.some((p) => p.value === r.randomPool)) out.randomPool = r.randomPool
    if (OPPONENTS.some((o) => o.id === r.opponent)) out.opponent = r.opponent as OpponentName
    if (typeof r.seedText === 'string') out.seedText = r.seedText
    return out
  } catch {
    return {}
  }
}

export function NewGameScreen({
  onStart,
  runPanel = null,
}: {
  readonly onStart: (setup: SetupOptions, opponent: OpponentName) => void
  /** The run section (v3 Phase 4b), above the single game. */
  readonly runPanel?: ReactNode
}) {
  const [kept, setKept] = useState<readonly SavedForce[]>(() => readSavedForces())
  const [saved] = useState(() => readRemembered(kept))
  const [p1, setP1] = useState<SideChoice>(() => saved.p1 ?? defaultFor('treefolk'))
  const [p2, setP2] = useState<SideChoice | { readonly kind: 'random' }>(
    () => saved.p2 ?? defaultFor('firewalkers'),
  )
  const [randomSize, setRandomSize] = useState<'same' | number>(saved.randomSize ?? 'same')
  const [randomPool, setRandomPool] = useState(saved.randomPool ?? 'mixed')
  const [unequal, setUnequal] = useState(false)
  const [opponent, setOpponent] = useState<OpponentName>(saved.opponent ?? DEFAULT_OPPONENT)
  const [seedText, setSeedText] = useState(saved.seedText ?? '')
  const [building, setBuilding] = useState(false)
  const opponentNote = OPPONENTS.find((o) => o.id === opponent)?.note

  useEffect(() => {
    writeText(REMEMBER_KEY, JSON.stringify({ p1, p2, randomSize, randomPool, opponent, seedText }))
  }, [p1, p2, randomSize, randomPool, opponent, seedText])

  if (building) {
    return (
      <ArmyBuilder
        onClose={(play) => {
          const now = readSavedForces()
          setKept(now)
          setP1(play !== null ? { kind: 'kept', id: play } : stillThere(p1, now, defaultFor('treefolk')))
          setP2(stillThere(p2, now, defaultFor('firewalkers')))
          setBuilding(false)
        }}
      />
    )
  }

  const pool: ForcePool = POOLS.find((p) => p.value === randomPool)?.pool ?? { kind: 'mixed' }
  const p2Side: OpponentSide = p2.kind === 'random' ? { kind: 'random', size: randomSize, pool } : p2
  const request = { p1, p2: p2Side, unequal, seedText }

  // Recomputed on every change rather than on submit, so the screen says what is
  // wrong while you are looking at it. The 0 stands in for the seed Start rolls.
  const chosen = newGameSetup(request, kept, 0)
  const rolled = randomGameSetup(seedText, 0)
  const differ = chosen.health !== undefined && chosen.health.p1 !== chosen.health.p2
  const keptP1 = p1.kind === 'kept' ? kept.find((f) => f.id === p1.id) : undefined
  const yourHealth =
    p1.kind === 'preset'
      ? (CHOICES.find((c) => c.id === p1.id)?.health ?? null)
      : keptP1 === undefined
        ? null
        : forceHealth(keptP1.force)

  const begin = (build: (randomSeed: number) => ReturnType<typeof randomGameSetup>) => {
    const result = build(newSeed())
    if (result.kind === 'ok') onStart(result.setup, opponent)
  }

  return (
    <div className="app">
      <div className="new-game">
        <h1>dd_solo</h1>
        {runPanel}
        <h2 className="new-game-section">A single game</h2>
        <p className="muted">
          Pick what each side brings, build a force of your own, or roll the whole thing.
        </p>

        <SidePicker
          label="Your side"
          side={p1}
          kept={kept}
          opponent={false}
          onChange={(side) => side.kind !== 'random' && setP1(side)}
        />
        <SidePicker label="Opponent's side" side={p2} kept={kept} opponent onChange={setP2} />

        {p2.kind === 'random' && (
          <div className="new-game-row">
            <label className="new-game-field">
              <span className="new-game-label">Its size</span>
              <select
                value={String(randomSize)}
                onChange={(e) => setRandomSize(e.target.value === 'same' ? 'same' : Number(e.target.value))}
              >
                <option value="same">The same as yours{yourHealth !== null ? ` (${yourHealth})` : ''}</option>
                {RANDOM_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} health
                  </option>
                ))}
              </select>
            </label>
            <label className="new-game-field">
              <span className="new-game-label">Drawn from</span>
              <select value={randomPool} onChange={(e) => setRandomPool(e.target.value)}>
                {POOLS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Asked only while the sizes differ, or once said: "on purpose" is the one thing
            this screen cannot work out for itself. */}
        {(differ || unequal) && (
          <label className="new-game-check">
            <input type="checkbox" checked={unequal} onChange={(e) => setUnequal(e.target.checked)} />
            <span>
              The sizes differ on purpose
              {chosen.health !== undefined && (
                <span className="muted">
                  {' '}
                  · {chosen.health.p1} against {chosen.health.p2} health
                </span>
              )}
            </span>
          </label>
        )}

        <label className="new-game-field">
          <span className="new-game-label">Opponent</span>
          <select value={opponent} onChange={(e) => setOpponent(e.target.value as OpponentName)}>
            {OPPONENTS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <span className="new-game-note muted">{opponentNote}</span>
        </label>

        <label className="new-game-field">
          <span className="new-game-label">Seed</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="leave empty to roll one"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
          />
          <span className="new-game-note muted">
            The same seed and the same forces replay the same game, die for die -- a random
            opponent included.
          </span>
        </label>

        {chosen.kind === 'problem' && <p className="banner warn">{chosen.problem}</p>}

        <div className="choices">
          <button
            type="button"
            className="choice"
            disabled={chosen.kind === 'problem'}
            onClick={() => begin((seed) => newGameSetup(request, kept, seed))}
          >
            Start
          </button>
          <button
            type="button"
            className="choice secondary"
            disabled={rolled.kind === 'problem'}
            onClick={() => begin((seed) => randomGameSetup(seedText, seed))}
          >
            Roll everything instead
          </button>
          <button type="button" className="choice secondary" onClick={() => setBuilding(true)}>
            Army builder
          </button>
        </div>
      </div>
    </div>
  )
}
