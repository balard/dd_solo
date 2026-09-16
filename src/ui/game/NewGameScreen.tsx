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
 */
import { useState } from 'react'

import type { SetupOptions } from '../../engine/setup'

import { speciesInfo } from './Elements'
import {
  choiceGroups,
  newGameSetup,
  randomGameSetup,
  presetChoices,
} from './newGame'
import { newSeed } from './useGame'

const GROUPS = choiceGroups()
const CHOICES = presetChoices()

const byId = new Map(CHOICES.map((c) => [c.id, c]))

/** The lightest force of that species, which is a monster fixture -- the board this
 *  screen was built to make reachable, so it is the one it opens on. */
function defaultFor(species: string): string {
  const found = CHOICES.find((c) => c.species === species) ?? CHOICES[0]
  if (found === undefined) throw new Error('no presets are loaded, so there is nothing to start')
  return found.id
}

function Picker({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (id: string) => void
}) {
  const choice = byId.get(value)
  if (choice === undefined) throw new Error(`no such preset: ${value}`)

  return (
    <label className="new-game-field">
      <span className="new-game-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {GROUPS.map((group) => (
          <optgroup key={group.health} label={`${group.health} health`}>
            {group.choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="new-game-note muted">
        {speciesInfo(choice.species)?.name ?? choice.species} · {choice.health} health ·{' '}
        {choice.split} dice across home, Frontier, enemy home
      </span>
    </label>
  )
}

export function NewGameScreen({ onStart }: { readonly onStart: (setup: SetupOptions) => void }) {
  const [p1, setP1] = useState(() => defaultFor('treefolk'))
  const [p2, setP2] = useState(() => defaultFor('firewalkers'))
  const [seedText, setSeedText] = useState('')

  // Recomputed on every keystroke rather than on submit, so the seed box says it is
  // wrong while you are looking at it.
  const chosen = newGameSetup(p1, p2, seedText, 0)
  const rolled = randomGameSetup(seedText, 0)

  const begin = (build: (randomSeed: number) => ReturnType<typeof randomGameSetup>) => {
    const result = build(newSeed())
    if (result.kind === 'ok') onStart(result.setup)
  }

  return (
    <div className="app">
      <div className="new-game">
        <h1>dd_solo</h1>
        <p className="muted">
          Pick what each side brings, or roll the whole thing. Forces can only face a force of the
          same health.
        </p>

        <Picker label="Your side" value={p1} onChange={setP1} />
        <Picker label="Opponent" value={p2} onChange={setP2} />

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
            The same seed and the same forces replay the same game, die for die.
          </span>
        </label>

        {chosen.kind === 'problem' && <p className="banner warn">{chosen.problem}</p>}

        <div className="choices">
          <button
            type="button"
            className="choice"
            disabled={chosen.kind === 'problem'}
            onClick={() => begin((seed) => newGameSetup(p1, p2, seedText, seed))}
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
        </div>
      </div>
    </div>
  )
}
