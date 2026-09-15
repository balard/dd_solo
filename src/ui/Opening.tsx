/**
 * Phases 1-2 made visible: set a seed, see the opening position it produces and
 * what the armies roll.
 *
 * Throwaway, like the rest of the Phase 0 smoke page -- Phase 7 replaces all of it.
 * There is no gameplay here and cannot be until Phases 4-5: the reducer has no
 * phases implemented, so nothing is ever pending and no action is ever legal.
 */
import { useState } from 'react'

import { terrainDie, terrainFaceAction, unitType } from '../data/load'
import type { ResultType, TerrainFaceNumber } from '../data/types'
import { rollArmy } from '../engine/roll'
import { setupGame } from '../engine/setup'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type PlayerId,
  type TerrainSlot,
} from '../engine/types'
import { validateState } from '../engine/validate'

const SLOT_LABEL: Record<TerrainSlot, string> = {
  p1_home: 'P1 home',
  frontier: 'Frontier',
  p2_home: 'P2 home',
}

const ACTION_RESULT: Record<string, ResultType> = {
  MELEE: 'melee',
  MISSILE: 'missile',
  MAGIC: 'magic',
}

function health(state: GameState, player: PlayerId, slot: TerrainSlot): number {
  return armyAt(state, player, slot).reduce((sum, u) => sum + unitType(u.typeId).health, 0)
}

/**
 * What this army would roll for the terrain's current action, and for saves.
 *
 * Derived from the game's own RNG so it is stable across re-renders rather than
 * flickering on every paint -- the same seed always shows the same sample.
 */
function sampleRolls(state: GameState, player: PlayerId, slot: TerrainSlot, action: ResultType) {
  const units = armyAt(state, player, slot)
  const offset = slot.length + (player === 'p1' ? 0 : 97)
  const rng = { seed: state.rng.seed, counter: state.rng.counter + offset }
  const [attack] = rollArmy(units, action, rng, state.ruleSet)
  const [save] = rollArmy(units, 'save', { ...rng, counter: rng.counter + 40 }, state.ruleSet)
  return { attack: attack.total, save: save.total }
}

function ArmyCell({
  state,
  player,
  slot,
  action,
}: {
  state: GameState
  player: PlayerId
  slot: TerrainSlot
  action: ResultType | null
}) {
  const units = armyAt(state, player, slot)
  const sample = action === null ? null : sampleRolls(state, player, slot, action)

  return (
    <td>
      <div className="meta">
        {units.length} dice · {health(state, player, slot)} health
        {sample && (
          <>
            {' · '}
            <span className={`i-${action?.toUpperCase() ?? ''}`}>
              rolls {sample.attack} {action}
            </span>
            {', '}
            <span className="i-SAVE">{sample.save} save</span>
          </>
        )}
      </div>
      <div className="faces">
        {units.map((u) => (
          <span key={u.id} className="face">
            <b>{unitType(u.typeId).health}</b>
            <span>{unitType(u.typeId).name}</span>
          </span>
        ))}
      </div>
    </td>
  )
}

export function Opening() {
  const [seedText, setSeedText] = useState('1234')
  const seed = Number.parseInt(seedText, 10)
  const validSeed = Number.isFinite(seed)

  const state = validSeed
    ? setupGame({ seed, forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' } })
    : null

  const problems = state ? validateState(state) : []
  const orderEntry = state?.log.find((e) => e.kind === 'order_of_play')

  return (
    <section>
      <h2>Opening position</h2>

      <div className="controls">
        <label>
          Seed{' '}
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            inputMode="numeric"
            size={8}
          />
        </label>
        <button onClick={() => setSeedText(String(Math.trunc(Date.now() % 100000)))}>
          Random seed
        </button>
        {[1, 2, 3, 7, 21].map((s) => (
          <button key={s} onClick={() => setSeedText(String(s))}>
            {s}
          </button>
        ))}
      </div>

      {!state && <p className="note">Enter a whole number for the seed.</p>}

      {state && (
        <>
          <p className="sub">
            P1 Treefolk vs P2 Firewalkers ·{' '}
            {orderEntry?.kind === 'order_of_play' ? (
              <>
                Horde roll-off {orderEntry.rolls.p1}–{orderEntry.rolls.p2}, so{' '}
                <b>{orderEntry.firstPlayer}</b> marches first
              </>
            ) : (
              <>{state.turn.marching} marches first</>
            )}{' '}
            · {problems.length === 0 ? 'state valid' : `${problems.length} INVARIANT VIOLATIONS`}
          </p>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Die</th>
                  <th>Face</th>
                  <th>P1 — Treefolk</th>
                  <th>P2 — Firewalkers</th>
                </tr>
              </thead>
              <tbody>
                {TERRAIN_SLOTS.map((slot) => {
                  const terrain = state.terrains[slot]
                  const icon =
                    terrain.face === 8
                      ? null
                      : terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber)
                  const action = icon === null ? null : (ACTION_RESULT[icon] as ResultType)
                  return (
                    <tr key={slot}>
                      <td className="name">{SLOT_LABEL[slot]}</td>
                      <td className="meta">{terrain.dieId.replace('_', ' ')}</td>
                      <td className="meta">
                        {terrain.face} —{' '}
                        <span className={`i-${icon ?? ''}`}>
                          {icon?.toLowerCase() ?? terrainDie(terrain.dieId).eighthFace}
                        </span>
                      </td>
                      <ArmyCell state={state} player="p1" slot={slot} action={action} />
                      <ArmyCell state={state} player="p2" slot={slot} action={action} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="note">
            <b>Nothing here is playable yet.</b> This is the position <code>setupGame</code>{' '}
            produces, plus one sample roll per army for whatever action its terrain currently
            allows. Turn structure and maneuvering arrive in Phase 4, combat in Phase 5.
            <br />
            <br />
            Every terrain is contested at setup, because each side&rsquo;s Horde Army deploys onto
            the opponent&rsquo;s Home Terrain. Changing the seed re-rolls the order of play and the
            opening faces; deployment is fixed by the presets.
          </p>
        </>
      )}
    </section>
  )
}
