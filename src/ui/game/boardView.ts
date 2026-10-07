/**
 * The board as the player has seen it (v2 Phase 9c).
 *
 * The cards walk through the log behind the game, a stop at a time (`presentation.ts`),
 * but the state is already past all of it: while a Firecloud card was up its victim had
 * already gone from the board, and the ticker read "4 melee − 0 saves = 4 damage" over
 * the saves card. So the board, the ticker and the log are drawn from a state rebuilt to
 * a point in the log, and nothing past that point shows until its card has.
 *
 * **Rebuilt forwards, from the state before the last action.** Every entry the cards
 * have not passed belongs to the last action: the opponent waits on the cards and your
 * own decision is not offered until they are done, so no action happens while one is
 * waiting. `useGame` keeps that state (`Session.before`), and this replays the entries
 * since it that are already seen, kind by kind -- each says where a die went, which is
 * all a board needs. Forwards rather than backwards from now, because a change the log
 * never names (Accelerated Growth's dying dice, parked in the DUA until the offer is
 * answered) then stays unshown rather than showing early. The safe direction to miss in.
 * Nothing here needs per-entry engine state, so `GameState` and the goldens did not move.
 *
 * **Effects are matched by name.** An `effect_cast` says what was cast and where, but a
 * Hypnotic Glare writes several effects under one `sai_resolved`, and a dragon's breath
 * writes one under its element. So an effect new in this action shows once an entry that
 * names its source is seen, and one gone since shows until an expiry that names it is --
 * then `pruneEffects` drops whatever the rebuilt board left without an army.
 */
import { BREATH_NAME } from '../../engine/dragons'
import { pruneEffects, type Effect } from '../../engine/effects'
import type {
  ArmyRef,
  DragonInPlay,
  GameState,
  Location,
  LogEntry,
  TerrainInPlay,
  TerrainSlot,
  UnitId,
  UnitInstance,
} from '../../engine/types'

const at = (ref: ArmyRef): Location => (ref === 'reserve' ? { kind: 'reserve' } : { kind: 'terrain', slot: ref })

/**
 * The board `now` was at log index `upTo`, rebuilt from `before`: the state the last
 * action started from. Returns `now` itself when nothing is held back, so a game with
 * no card up renders exactly as it did.
 */
export function boardAt(now: GameState, before: GameState, upTo: number): GameState {
  if (upTo >= now.log.length) return now
  return rebuild(now, before, upTo)
}

/** `boardAt` without the short cut, for the test that replays a whole action through it. */
export function rebuild(now: GameState, before: GameState, upTo: number): GameState {
  const from = before.log.length
  const seen = now.log.slice(from, Math.max(from, upTo))

  const units: Record<UnitId, UnitInstance> = { ...before.units }
  const move = (id: UnitId, location: Location) => {
    const unit = units[id]
    if (unit !== undefined) units[id] = { ...unit, location }
  }
  const swap = (a: UnitId, b: UnitId) => {
    const one = units[a]
    const other = units[b]
    if (one === undefined || other === undefined) return
    units[a] = { ...one, location: other.location }
    units[b] = { ...other, location: one.location }
  }
  let terrains: Record<TerrainSlot, TerrainInPlay> = { ...before.terrains }
  const turn = (slot: TerrainSlot, change: Partial<TerrainInPlay>) => {
    terrains[slot] = { ...terrains[slot], ...change }
  }
  const dragons: Record<string, DragonInPlay> = { ...before.dragons }
  const dyingFrom = new Map(
    (before.turn.growthOffers ?? []).flatMap((offer) => offer.dying.map((d) => [d.unitId, d.from] as const)),
  )
  // The roll-off's choice changes only the setup, sometimes without a line of its own
  // (the winner taking the first turn); it is held back only behind its own entry.
  const decided = now.log.slice(Math.max(from, upTo)).some((entry) => entry.kind === 'roll_off_decided')
  const rollOff = decided ? before.rollOff : now.rollOff
  let winner = before.winner
  // What the seen entries name an effect by, and which expiries they report.
  const named = new Set<string>()
  const expired = new Set<string>()

  for (const entry of seen) {
    for (const name of namesOf(entry)) named.add(name)
    switch (entry.kind) {
      case 'units_killed':
        for (const id of entry.unitIds) move(id, { kind: 'dua' })
        break
      case 'units_buried':
        for (const id of entry.unitIds) move(id, { kind: 'bua' })
        break
      case 'replanting':
        // A die that takes root is never killed: it goes to Reserves instead.
        for (const id of entry.rooted) move(id, { kind: 'reserve' })
        break
      case 'units_risen':
      case 'units_sent_home':
      case 'retreated':
        for (const id of entry.unitIds) move(id, { kind: 'reserve' })
        break
      case 'sai_resolved':
        // Roar: straight to Reserves, never killed.
        if (entry.toReserve === true) for (const id of entry.unitIds) move(id, { kind: 'reserve' })
        break
      case 'sai_sub_roll':
        // Seize's survivors go to Reserves; Mirage's and Fearful Flames' failures flee there.
        if (entry.toReserve === true) for (const id of entry.escaped) move(id, { kind: 'reserve' })
        if (entry.fate === 'flee') {
          for (const die of entry.dice) if (!entry.escaped.includes(die.unitId)) move(die.unitId, { kind: 'reserve' })
        }
        break
      case 'dragon_breath':
        for (const id of entry.unitIds) move(id, { kind: 'dua' })
        break
      // An exchange swaps places, whichever way it runs.
      case 'units_promoted':
        for (const pair of entry.pairs) swap(pair.unitId, pair.partnerId)
        break
      // Except Accelerated Growth's: the dying die went to the DUA when the offer was
      // raised, with no line, so the partner's place is the one the offer remembers.
      case 'units_regrown':
        for (const pair of entry.pairs) {
          const from = dyingFrom.get(pair.unitId)
          if (from === undefined) {
            swap(pair.unitId, pair.partnerId)
          } else {
            move(pair.partnerId, at(from))
            move(pair.unitId, { kind: 'dua' })
          }
        }
        break
      case 'units_regenerated':
      case 'units_resurrected':
        for (const id of entry.unitIds) move(id, at(entry.slot))
        break
      case 'units_recruited':
        for (const id of entry.unitIds) move(id, { kind: 'terrain', slot: entry.slot })
        break
      case 'units_moved':
        for (const id of entry.unitIds) move(id, { kind: 'terrain', slot: entry.to })
        break
      case 'reinforced':
        for (const { unitId, slot } of entry.moves) move(unitId, { kind: 'terrain', slot })
        break
      case 'air_flight':
        for (const { unitId, to } of entry.moves) move(unitId, { kind: 'terrain', slot: to })
        break
      case 'terrain_moved':
        turn(entry.slot, { face: entry.to })
        break
      case 'terrain_captured':
        turn(entry.slot, { capturedBy: entry.by })
        break
      case 'terrain_lost':
        // Out-maneuvered, the face moved already; abandoned, it turns back to 7.
        turn(entry.slot, entry.reason === 'abandoned' ? { capturedBy: null, face: 7 } : { capturedBy: null })
        break
      // The roll-off's choice places the Frontier and rolls every face: the setup is
      // the one board no entry describes die by die, and nothing is hidden behind it.
      case 'roll_off_decided':
        terrains = { ...now.terrains }
        break
      case 'dragon_summoned':
        if (dragons[entry.dragonId] !== undefined) {
          dragons[entry.dragonId] = { ...(dragons[entry.dragonId] as DragonInPlay), location: { kind: 'terrain', slot: entry.slot } }
        }
        break
      case 'dragon_home':
        if (dragons[entry.dragonId] !== undefined) {
          dragons[entry.dragonId] = { ...(dragons[entry.dragonId] as DragonInPlay), location: { kind: 'pool' } }
        }
        break
      case 'effects_expired':
        for (const source of entry.sources) expired.add(source)
        break
      case 'victory':
        winner = now.winner
        break
      default:
        break
    }
  }

  // Kept: what was there before unless it expired in sight. Added: what this action
  // made, once its cause is seen. In the order the engine holds them.
  const old = new Set(before.effects)
  const effects: Effect[] = [
    ...before.effects.filter((effect) => now.effects.includes(effect) || !expired.has(effect.source)),
    ...now.effects.filter((effect) => !old.has(effect) && named.has(effect.source)),
  ]

  const { rollOff: _open, ...rest } = now
  const rebuilt: GameState = {
    ...rest,
    ...(rollOff === undefined ? {} : { rollOff }),
    units,
    terrains,
    dragons,
    effects,
    winner,
    log: now.log.slice(0, upTo),
  }
  return pruneEffects(rebuilt)
}

/** The effect sources an entry names: the spell, the SAI or the breath behind it. */
function namesOf(entry: LogEntry): readonly string[] {
  switch (entry.kind) {
    case 'effect_cast':
    case 'sai_sub_roll':
      return [entry.source]
    case 'sai_resolved':
    case 'units_regenerated':
    case 'confused':
      return [entry.sai]
    case 'spell_cast':
      return [entry.spell]
    case 'dragon_breath_effect':
      return [BREATH_NAME[entry.element]]
    default:
      return []
  }
}

/**
 * What a card is about to do to each die it touches, for the board to mark (9a finding
 * 8): the die stays where it was, as if nothing had happened, and says what is coming.
 * A death wins over anything else said about the same die -- a Flame's victim is
 * "buried", not "Flame".
 */
export function marksIn(entries: readonly LogEntry[]): ReadonlyMap<UnitId, string> {
  const marks = new Map<UnitId, string>()
  const say = (ids: readonly UnitId[], mark: string, strong = false) => {
    for (const id of ids) if (strong || !marks.has(id)) marks.set(id, mark)
  }
  for (const entry of entries) {
    switch (entry.kind) {
      case 'units_killed':
      case 'dragon_breath':
        say(entry.unitIds, 'falls', true)
        break
      case 'units_buried':
        say(entry.unitIds, 'buried', true)
        break
      case 'sai_resolved':
        say(entry.unitIds, entry.toReserve === true ? 'to reserves' : entry.sai)
        break
      case 'sai_sub_roll':
        if (entry.toReserve === true) say(entry.escaped, 'to reserves', true)
        if (entry.fate === 'flee') {
          say(entry.dice.map((die) => die.unitId).filter((id) => !entry.escaped.includes(id)), 'flees', true)
        }
        break
      case 'effect_cast':
        if (entry.unitId !== undefined) say([entry.unitId], entry.source)
        break
      case 'units_risen':
        say(entry.unitIds, 'rises', true)
        break
      case 'replanting':
        say(entry.rooted, 'takes root', true)
        break
      case 'units_moved':
      case 'units_sent_home':
        say(entry.unitIds, 'moves', true)
        break
      case 'air_flight':
        say(entry.moves.map((m) => m.unitId), 'flies', true)
        break
      case 'units_promoted':
      case 'units_regrown':
        say(entry.pairs.map((p) => p.unitId), 'exchanged', true)
        say(entry.pairs.map((p) => p.partnerId), 'returns', true)
        break
      case 'units_regenerated':
      case 'units_resurrected':
      case 'units_recruited':
        say(entry.unitIds, 'returns', true)
        break
      default:
        break
    }
  }
  return marks
}
