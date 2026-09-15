/**
 * Phase 1 made visible: the opening position from `setupGame`.
 *
 * Throwaway, like the rest of the Phase 0 smoke page -- Phase 7 replaces all of it.
 * It exists so the setup can be eyeballed rather than only asserted.
 */
import { terrainDie, terrainFaceAction, unitType } from '../data/load'
import type { TerrainFaceNumber } from '../data/types'
import { setupGame } from '../engine/setup'
import { TERRAIN_SLOTS, armyAt, type GameState, type PlayerId, type TerrainSlot } from '../engine/types'
import { validateState } from '../engine/validate'

const SEED = 1234

const state: GameState = setupGame({
  seed: SEED,
  forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' },
  firstPlayer: 'p1',
})

const problems = validateState(state)

const SLOT_LABEL: Record<TerrainSlot, string> = {
  p1_home: 'P1 home',
  frontier: 'Frontier',
  p2_home: 'P2 home',
}

function ArmyCell({ player, slot }: { player: PlayerId; slot: TerrainSlot }) {
  const units = armyAt(state, player, slot)
  const health = units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)
  return (
    <td>
      <div className="meta">
        {units.length} dice · {health} health
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
  return (
    <section>
      <h2>Opening position</h2>
      <p className="sub">
        Seed {SEED} · P1 Treefolk vs P2 Firewalkers · {state.turn.marching} marches first ·{' '}
        {problems.length === 0 ? 'state valid' : `${problems.length} INVARIANT VIOLATIONS`}
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
              const action =
                terrain.face === 8
                  ? terrainDie(terrain.dieId).eighthFace.replace('_', ' ')
                  : terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber).toLowerCase()
              return (
                <tr key={slot}>
                  <td className="name">{SLOT_LABEL[slot]}</td>
                  <td className="meta">{terrain.dieId.replace('_', ' ')}</td>
                  <td className="meta">
                    {terrain.face} — {action}
                  </td>
                  <ArmyCell player="p1" slot={slot} />
                  <ArmyCell player="p2" slot={slot} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Every terrain is contested at setup, because each side&rsquo;s Horde Army deploys to the
        opponent&rsquo;s Home Terrain. Re-seeding changes only the opening faces — deployment is
        fixed by the presets.
      </p>
    </section>
  )
}
