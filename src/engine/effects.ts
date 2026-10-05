/**
 * Effects with a duration: what the board says about a roll beyond the dice in it.
 *
 * v0 had exactly one thing to say -- the eighth-face holder doubles their ID results
 * -- and it rode into `rollArmy` as a boolean. Everything from here on says more:
 * Galeforce takes four save and four maneuver results off an army until the caster's
 * next turn, Sleep stops a unit being rolled at all, dragon breath and every spell
 * with a duration land in the same list. So the boolean becomes a `Modifier[]`, and
 * this file is the one place that answers "what modifies this army's roll" -- because
 * a call site that remembers the eighth face and forgets Galeforce is the failure
 * mode, and it is silent.
 *
 * Three rules from *Army Modifiers* (full rules p. 28) give the shape:
 *
 *  - An army effect is fixed to a **location**, not to the units. March away and the
 *    effect does not follow; arrive later and it applies to you anyway. That is why
 *    `target` names an `ArmyRef` and a player rather than a unit list.
 *  - An army effect **ends when the army has no units left**, checked at the end of
 *    each action -- but not when every unit was replaced in a single exchange, since
 *    then the army is never observed empty at all.
 *  - A unit effect **follows the unit** into another army, which it does for free by
 *    naming a `UnitId`.
 *
 * And one from *Roll Modifiers*, same page, which is why the entry point is named
 * `armyRoll` and not `rollModifiers`: "Modifiers that affect an army do not affect
 * the roll of an individual unit from that army. Modifiers that affect an individual
 * unit do not affect the roll of an army." Phase 4d's sub-rolls are the first unit
 * rolls in the game, and they go through `unitRoll` below -- a sibling of `armyRoll`
 * and deliberately not a call into it.
 *
 * **Sleep and Galeforce are what produce an `Effect`** (Phase 4c), three phases after
 * this file was written -- both cast in the middle of an attack roll, at the pause the
 * 4a seam exists for. They are on the `sai: 'full'` rung, so `state.effects` is still
 * always empty in a `DUA_RULES` game, which is what the app plays.
 */
import {
  doubleIdsModifier,
  maneuverAsSaves,
  meleeAsManeuver,
  savesAsMelee,
  savesAsMeleeOnCounter,
  type Modifier,
  type RollEffect,
} from './pipeline'
import { terrainHas, unitHasAbility, type AbilityName } from './species'
import { terrainDie } from '../data/load'
import { SPELLS } from '../data/spells'
import type { EighthFaceIcon, Element, ResultType } from '../data/types'
import {
  army as armyOf,
  armyRefOf,
  speciesIn,
  type ArmyRef,
  type GameState,
  type LogEntry,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'

/**
 * Where an effect sits: on an army at a place, on one unit, or on a terrain.
 *
 * The `terrain` member is Phase 7b's, added with the code that reads it -- the rules
 * name five target kinds for a spell (army, unit(s), terrain, DUA, BUA) and three of
 * the eighteen target a terrain. It carries a **scope**, because "targets a terrain"
 * is not one rule: Ash Storm reaches every army standing there and Wall of Fog reaches
 * an army attacking *into* there from somewhere else. Without the scope one kind would
 * wear two unrelated meanings and every gatherer would have to guess which.
 */
export type EffectTarget =
  | { readonly kind: 'army'; readonly player: PlayerId; readonly army: ArmyRef }
  | { readonly kind: 'unit'; readonly unitId: UnitId }
  | { readonly kind: 'terrain'; readonly slot: TerrainSlot; readonly scope: TerrainScope }
  /**
   * Accelerated Growth: "target your DUA". Not a place a roll happens and not an army
   * that can empty -- it follows the *player*, and it is read by `killUnits` rather
   * than by anything that throws dice.
   */
  | { readonly kind: 'player'; readonly player: PlayerId }

/**
 * Who a terrain-scoped effect reaches.
 *
 * `'maneuverers'` is Phase 7d's (Wall of Thorns) and is deliberately absent until
 * something gathers it -- the same rule that kept `terrain` itself out until now.
 */
export type TerrainScope =
  /** Ash Storm: every army at the terrain, both players'. */
  | 'all_armies'
  /** Wall of Fog: a roll aimed *at* this terrain, made from somewhere else. */
  | 'attackers'
  /**
   * Wall of Thorns: an army that successfully maneuvers this terrain.
   *
   * **Gathered by no roll at all**, which is why `armyRoll` names it and returns
   * nothing for it. It is read at the maneuver site, once, after the terrain has
   * turned -- the only effect in the game that fires on an event rather than on a
   * die being thrown.
   */
  | 'maneuverers'
  /**
   * Soiled Ground (v2 Phase 7e): a unit killed at this terrain. Gathered by no roll,
   * like `'maneuverers'`: `killUnits` reads it, on the event of a death.
   */
  | 'deaths'

export interface Effect {
  /** Spell name, SAI name, breath element -- what the log names it by. */
  readonly source: string
  readonly target: EffectTarget
  /** Steps 6, 7, 9 and 10. Galeforce is two of these: subtract 4 save, subtract 4
   *  maneuver. Empty for a status like Sleep, which is not arithmetic. */
  readonly modifiers: readonly Modifier[]
  /** Sleep: the unit cannot be rolled, and cannot leave the terrain it occupies. */
  readonly asleep?: true
  /**
   * Hypnotic Glare (v2 Phase 5b): the unit "may not be rolled" -- Sleep's first half
   * without its second. A hypnotized die may still retreat, be moved or be killed; it
   * simply takes no part in any roll, army or unit.
   */
  readonly hypnotized?: true
  /**
   * Hypnotic Glare's *source*: "the glaring unit may be excluded from any roll until the
   * effect expires". Excluded from every **army** roll, automatically -- a house rule,
   * `RULES-V0.md` section 11: the choice would be a pause before every roll its army
   * makes, and rolling the die ends the glare. A **unit** roll still rolls it, because a
   * die rolling for its life that sat out would simply die; that roll ends the glare.
   */
  readonly glaring?: true
  /**
   * Stun (v2 Phase 7b; no producer until 7c): "cannot be rolled until the beginning of
   * your turn, unless they are the target of an individual-targeting effect which forces
   * them to. Stunned units that leave the terrain through any means are no longer
   * stunned." So it keeps the die out of every **army** roll and out of nothing else: a
   * sub-roll still rolls it, it may retreat or be moved, and moving ends it -- an
   * `anchor` on the stunned die itself, 5b's end condition. `glaring`'s reach, without
   * its owner choosing it.
   */
  readonly stunned?: true
  /**
   * The effect lasts only while this unit stands at this terrain (v2 Phase 5b): it ends
   * the moment the unit leaves it or leaves play, and -- with `untilRolled` -- the moment
   * the unit is rolled. Hypnotic Glare's end conditions: "if the glaring unit leaves the
   * terrain, is killed, or is rolled". The first duration in the game that is not "until
   * the beginning of somebody's turn", and it runs *beside* that one, not instead of it.
   *
   * Named for a unit that may be neither the effect's target nor its caster's army:
   * a hypnotized die's effect is anchored to the Leviathan that glared at it.
   */
  readonly anchor?: {
    readonly unitId: UnitId
    readonly slot: TerrainSlot
    readonly untilRolled?: true
  }
  /**
   * Wall of Thorns: damage an army takes for successfully maneuvering this terrain.
   *
   * A field rather than a `Modifier`, for `asleep`'s reason: it is not arithmetic on a
   * roll. The army answers it with a **melee** roll in place of a save roll, which no
   * modifier could express either.
   */
  readonly thorns?: number
  /**
   * Flashfire: how many of the target army's dice its owner may re-roll, **once per
   * roll** rather than once in total.
   *
   * "During any non-maneuver army roll, the target's owner may re-roll any one unit in
   * the target army once ... This effect lasts until the beginning of your next turn."
   * The "once" governs the reroll inside a roll; the duration governs how many rolls
   * it reaches. Two separate castings therefore allow two dice, which is what makes
   * this a number rather than a flag.
   */
  readonly flashfire?: number
  /**
   * Illusion (v2 Phase 8b; no producer until 8d): "until the beginning of your next turn,
   * the target army cannot be targeted by any missile attacks or spells cast by opposing
   * players." On an **army at a place**, Galeforce's scope: it does not follow the units,
   * and a die that marches in later is shielded with the rest. A status rather than a
   * modifier, for `asleep`'s reason -- it changes who may be aimed at, not any number --
   * and read by one predicate, `shielded`.
   */
  readonly illusion?: true
  /** Accelerated Growth: what `killUnits` does instead of killing a Treefolk die.
   *  Soiled Ground (v2 Phase 7e): what it does after one -- a burial check, owed. */
  readonly trigger?: 'accelerated_growth' | 'soiled_ground'
  /**
   * "Until the beginning of your next turn" -- *your* being whoever made the roll,
   * which on a counter-attack is the defending player, not the marching one.
   *
   * Not nullable, though the plan's sketch was: an instantaneous effect never enters
   * this list, and nothing in scope is permanent, so the null branch would be one
   * nothing could reach. Phase 7 widens it if a spell needs it.
   */
  readonly expiresAtStartOfTurnOf: PlayerId
}

const targetsArmy = (effect: Effect, player: PlayerId, ref: ArmyRef): boolean =>
  effect.target.kind === 'army' && effect.target.player === player && effect.target.army === ref

const targetsUnit = (effect: Effect, unitId: UnitId): boolean =>
  effect.target.kind === 'unit' && effect.target.unitId === unitId

const targetsPlayer = (effect: Effect, player: PlayerId): boolean =>
  effect.target.kind === 'player' && effect.target.player === player

const targetsTerrain = (effect: Effect, ref: ArmyRef, scope: TerrainScope): boolean =>
  effect.target.kind === 'terrain' &&
  effect.target.scope === scope &&
  ref !== 'reserve' &&
  effect.target.slot === ref

/** Sleep: the die cannot be rolled *and* cannot leave its terrain. The second half is
 *  what the retreat and free-move checks ask; `cannotRoll` is the first. */
export function isAsleep(state: GameState, unitId: UnitId): boolean {
  return state.effects.some((effect) => targetsUnit(effect, unitId) && effect.asleep === true)
}

/** Hypnotic Glare's victims: may not be rolled, may still move. */
export function isHypnotized(state: GameState, unitId: UnitId): boolean {
  return state.effects.some((effect) => targetsUnit(effect, unitId) && effect.hypnotized === true)
}

/** Hypnotic Glare's source, sitting out its army's rolls to keep the glare alive. */
export function isGlaring(state: GameState, unitId: UnitId): boolean {
  return state.effects.some((effect) => targetsUnit(effect, unitId) && effect.glaring === true)
}

/** Stun's victims: out of army rolls, still rolled by a sub-roll, free to move. */
export function isStunned(state: GameState, unitId: UnitId): boolean {
  return state.effects.some((effect) => targetsUnit(effect, unitId) && effect.stunned === true)
}

/**
 * Whether this die may be rolled at all -- the question every roll asks, army or unit.
 * Sleep and Hypnotic Glare both say no; neither asks where the die may go.
 */
export function cannotRoll(state: GameState, unitId: UnitId): boolean {
  return isAsleep(state, unitId) || isHypnotized(state, unitId)
}

/** Whether this die sits out an *army* roll: everything `cannotRoll` refuses, and a
 *  glaring die keeping its glare (`Effect.glaring`). A unit roll asks `cannotRoll`. */
export function sitsOutArmyRoll(state: GameState, unitId: UnitId): boolean {
  return cannotRoll(state, unitId) || isGlaring(state, unitId) || isStunned(state, unitId)
}

/**
 * Whether this player's rolls with this army double their ID results.
 *
 * The eighth-face holder's bonus, and a fact about the board rather than about any
 * face -- the same die doubles or not depending on where it is standing. Gated on the
 * ruleset so `captureOnly` still plays the alpha game, where a capture won and did
 * nothing else. The Reserve Army holds no terrain and so never doubles.
 *
 * It lives here rather than in `combat.ts` because it is a step-9 modifier like any
 * other, and gathering it anywhere but beside the effects is how a roll ends up with
 * one of the two and not the other.
 */
export function doublesIds(state: GameState, player: PlayerId, ref: ArmyRef): boolean {
  if (ref === 'reserve') return false
  return state.ruleSet.eighthFace !== 'captureOnly' && state.terrains[ref].capturedBy === player
}

/**
 * The eighth-face icon this player may use at this terrain, or `null` (Phase 5c).
 *
 * Non-null exactly when `eighthFace: 'full'`, the terrain sits on face 8, and this
 * player is the one who captured it. Every icon power in Phase 5d and 5e asks this
 * and nothing else, which is what makes "losing the eighth face ends the icon's
 * effect in the same step" free: nothing is stored here, so there is nothing to
 * revoke -- `syncCaptures` and `moveTerrain` already turn face 8 back to 7 the
 * moment a capture is lost, and the next call to `iconAt` simply answers `null`.
 */
export function iconAt(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
): EighthFaceIcon | null {
  if (state.ruleSet.eighthFace !== 'full') return null
  const terrain = state.terrains[slot]
  if (terrain.face !== 8 || terrain.capturedBy !== player) return null
  return terrainDie(terrain.dieId).eighthFace
}

/**
 * The Temple's first sentence (v2 Phase 7b): "your controlling army and all units in it
 * cannot be affected by any opponent's death magic". True for the army this player has
 * at a Temple it holds on face 8, and nowhere else -- never a Reserve Army, which holds
 * no terrain.
 *
 * Through `iconAt`, so losing the capture ends the immunity in the same step, with
 * nothing stored to revoke. Dormant since v1 Phase 5e: nothing cast death magic until
 * the Goblins. Its readers arrive with the death spells in 7e -- the gather in
 * `armyRoll` (a Palsy cast before the capture stops biting while it is held), spell
 * targeting, and Soiled Ground's burial check -- each with a test that can reach it.
 */
export function deathMagicImmune(state: GameState, player: PlayerId, ref: ArmyRef): boolean {
  return ref !== 'reserve' && iconAt(state, player, ref) === 'temple'
}

/**
 * Casts an effect with a duration, and says so in the log.
 *
 * "Until the beginning of your next turn" -- *your* being the roller, which on a
 * counter-attack is the defending player rather than the marching one. `expireEffects`
 * reads that field at the top of each turn, so getting it wrong shortens or doubles
 * the effect rather than failing.
 *
 * Here rather than in `turn.ts` since v2 Phase 8c: Cloak is cast from a spell's save
 * roll as well as from the march, and `spells.ts` does not import the turn machine.
 */
export function castEffect(
  state: GameState,
  caster: PlayerId,
  effect: Effect,
  where: {
    /** Omitted for a terrain effect, which belongs to nobody. */
    readonly target?: PlayerId
    readonly slot: ArmyRef
    readonly unitId?: UnitId
  },
): GameState {
  return {
    ...state,
    effects: [...state.effects, effect],
    log: [
      ...state.log,
      {
        kind: 'effect_cast',
        player: caster,
        source: effect.source,
        ...(where.target !== undefined ? { target: where.target } : {}),
        slot: where.slot,
        ...(where.unitId !== undefined ? { unitId: where.unitId } : {}),
      },
    ],
  }
}

/**
 * Cloak's lasting half (v2 Phase 8c): every Cloak in a save roll that has just been
 * resolved, written as +X save on the roller's army at its place until the roller's
 * next turn. One effect per face, so two Cloaks are two effects and the chip counts them.
 *
 * **Called once the roll is resolved, and by every army save roll**: an exchange's (and
 * a Charge's), the dragon combination roll, Wall of Thorns' roll and a spell's save
 * roll. Written after, so the roll that rolled the Cloak counts its X once -- as its
 * own step-8 results -- and gathers the effect only from the next roll on. Not a
 * `Modifier.fromSpell`: the name is an SAI's, so a Cloak never reduces a riposte, a
 * Charge or a cursed missile ("non-magical").
 */
export function castCloaks(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  effects: readonly RollEffect[],
): GameState {
  return effects.reduce<GameState>((next, effect) => {
    if (effect.kind !== 'cloak') return next
    return castEffect(
      next,
      player,
      {
        source: effect.sai,
        target: { kind: 'army', player, army: ref },
        modifiers: [{ kind: 'add', resultType: 'save', amount: effect.saves }],
        expiresAtStartOfTurnOf: player,
      },
      // On the army, not the die that rolled it, so the line names no unit.
      { target: player, slot: ref },
    )
  }, state)
}

/**
 * What a shield can refuse (v2 Phase 8b). A death spell is a spell to an Illusion and
 * also the one thing the Temple refuses, which is why it is its own member.
 */
export type ShieldedFrom = 'missile' | 'spell' | 'death_spell'

/**
 * Whether `by` may not aim this at `player`'s army at `ref` (v2 Phase 8b): the one
 * targeting restriction, which every reader asks.
 *
 * Two rules in it, both about an *opponent*: Illusion, which refuses any missile
 * attack and any spell, and the Temple (7e), which refuses death magic. They are one
 * predicate because they are one question at the same readers -- the Temple's filter in
 * `spellTargets` was written first, and Illusion widens it rather than starting a
 * second one. A unit is shielded when its army is, so a unit spell aimed at a die in a
 * shielded army is refused too; a terrain is never shielded, since a terrain spell's
 * target is the terrain.
 *
 * Readers: `missileTargets` (the terrains and a Tower's Reserves), `spellTargets` (an
 * army offer and a unit offer), and `volleyers` (Defensive Volley's counter, which is a
 * missile attack at the marching army).
 */
export function shielded(
  state: GameState,
  by: PlayerId,
  player: PlayerId,
  ref: ArmyRef,
  from: ShieldedFrom,
): boolean {
  if (by === player) return false
  if (from === 'death_spell' && deathMagicImmune(state, player, ref)) return true
  return state.effects.some((effect) => effect.illusion === true && targetsArmy(effect, player, ref))
}

/**
 * Whether this ruleset resolves this icon at all -- the twin of `resolvesSai`, and
 * for the same reason: the answer changes by rung, so a table lookup can only ever
 * be right about one of them. Standing Stones is a rules fact, not unbuilt work: it
 * has nothing to do until magic is `'spells'` (Phase 7), on any `eighthFace` rung.
 */
export function resolvesIcon(icon: EighthFaceIcon, ruleSet: RuleSet): boolean {
  if (icon === 'standing_stones') return ruleSet.magic === 'spells'
  return ruleSet.eighthFace === 'full'
}

/**
 * One line per icon, for a hover label. Lives beside `iconAt` / `resolvesIcon` for
 * the reason `SAI_TEXT` sits beside `sai.ts`'s handlers: the sentence drifts the
 * moment it lives anywhere but next to the rule it describes.
 */
export const ICON_TEXT: Readonly<Record<EighthFaceIcon, string>> = {
  tower: 'may take a missile action against any army, including a Reserve Army',
  city: 'may recruit or promote one unit each Eighth Face Phase',
  temple: 'may force a burial each Eighth Face Phase; your army resists death magic',
  standing_stones: 'a magic bonus at this terrain, once spells land',
}

/**
 * What an eighth-face icon says on hover -- `faceLabel`'s twin. An icon this
 * ruleset cannot resolve reads "does nothing in this game", via `resolvesIcon`;
 * `null` means nobody said which rules these are, and claims nothing at all.
 */
export function eighthFaceLabel(icon: EighthFaceIcon, ruleSet: RuleSet | null): string {
  const name = icon.replace(/_/g, ' ')
  if (ruleSet === null || resolvesIcon(icon, ruleSet)) return `${name} — ${ICON_TEXT[icon]}`
  return `${name} — does nothing in this game`
}

/**
 * An effect's modifiers, each stamped with the effect's name (Phase 9c) -- so a roll can
 * say "− 4 Galeforce" rather than a number that changed with nothing on screen to say
 * why. Stamped here, at the one door every roll goes through, and never stored: the
 * effect in `state.effects` keeps its modifiers bare.
 */
function sourced(effect: Effect): readonly Modifier[] {
  const spell = SPELL_NAMES.has(effect.source)
  return effect.modifiers.map((modifier) => ({
    ...modifier,
    source: effect.source,
    ...(spell ? { fromSpell: true as const } : {}),
  }))
}

/**
 * The names an effect carries when a spell cast it (v2 Phase 6b). A spell's effect is
 * stamped with its spell's name by `spellEffect`, and an SAI's with the SAI's, and no
 * name is both -- `effects.test.ts` holds that, since a collision would let a Galeforce
 * reduce a riposte. Read off the name rather than stored on the effect because
 * `state.effects` is in the golden digest.
 */
const SPELL_NAMES: ReadonlySet<string> = new Set(SPELLS.map((s) => s.name))

/**
 * Whether a named step on a roll's arithmetic came from a spell (v2 Phase 8e): the
 * reader of `RollMath` that `Modifier.fromSpell` is to a gathered modifier, and by the
 * same rule -- the name. Cursed Bullets asks it of a save roll's steps, so the spell
 * saves it may be reduced by are the ones the roll actually counted.
 */
export function isSpellSource(source: string): boolean {
  return SPELL_NAMES.has(source)
}

/** The spells cast with death magic, by the name an effect carries as its source. */
const DEATH_SPELL_NAMES: ReadonlySet<string> = new Set(
  SPELLS.filter((s) => s.element === 'death').map((s) => s.name),
)

/**
 * Whether the Temple holds this effect off this army (v2 Phase 7e): "your controlling
 * army and all units in it cannot be affected by any opponent's death magic".
 *
 * A death spell's effect, cast by somebody other than this player -- its caster is
 * `expiresAtStartOfTurnOf`, "until the beginning of *your* next turn" -- on an army
 * standing at a Temple this player holds. Read off the effect's name against the data
 * rather than stamped on the effect, for `fromSpell`'s reason: `state.effects` is in the
 * golden digest.
 */
export function templeShields(state: GameState, effect: Effect, player: PlayerId, ref: ArmyRef): boolean {
  return (
    DEATH_SPELL_NAMES.has(effect.source) &&
    effect.expiresAtStartOfTurnOf !== player &&
    deathMagicImmune(state, player, ref)
  )
}

/**
 * The save results spells add to this army's rolls (v2 Phase 6b): Stone Skin, Watery
 * Double, however many castings.
 *
 * What "only save results generated by spells that would add to a save roll may reduce
 * this damage" asks -- Counter's and Volley's riposte, and Charge's melee -- where the
 * army hit makes no roll of its own for a spell to add to. Gathered through `armyRoll`,
 * the one door, so an effect that reaches the army by its terrain counts exactly as it
 * would on a real save roll. Only additions: a spell that takes saves away reduces
 * nothing here, and neither does an SAI's Galeforce.
 */
export function spellSaves(state: GameState, player: PlayerId, ref: ArmyRef): number {
  return spellSaveSources(state, player, ref).reduce((sum, s) => sum + s.amount, 0)
}

/** `spellSaves` by spell, in the order `armyRoll` gathers them, so a reduction can be
 *  named -- "− 2 Stone Skin" -- the way a roll's arithmetic is (Phase 9c). */
export function spellSaveSources(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
): readonly { readonly source: string; readonly amount: number }[] {
  const out: { source: string; amount: number }[] = []
  for (const m of armyRoll(state, player, ref, 'save').modifiers) {
    if (m.kind !== 'add' || m.resultType !== 'save' || m.fromSpell !== true) continue
    const source = m.source ?? 'spells'
    const same = out.find((s) => s.source === source)
    if (same !== undefined) same.amount += m.amount
    else out.push({ source, amount: m.amount })
  }
  return out
}

/** What `rollArmy` needs to roll one army: which of its dice may be rolled, and
 *  everything modifying the result. */
export interface ArmyRollInput {
  readonly units: readonly UnitInstance[]
  readonly modifiers: readonly Modifier[]
}

/**
 * The one door every army roll goes through.
 *
 * Returns both halves together on purpose. They are two questions -- who rolls, and
 * what modifies it -- and a call site that answers one and forgets the other is a bug
 * with no symptom: a sleeping die quietly rolling, or a Galeforce quietly not
 * applying. One call cannot half-happen.
 */
export function armyRoll(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  resultType: ResultType,
  /**
   * The army this roll is aimed at, when it is aimed at one.
   *
   * Wall of Fog is the only thing that reads it and the reason it exists: "subtract
   * six missile results from any missile attack targeting an army at that terrain"
   * puts a modifier on the *attacker's* roll, keyed by the *defender's* terrain, and
   * the other four arguments describe only the roller.
   *
   * **`attackRollSpec` in `combat.ts` is its only caller.** Gathering it anywhere
   * else would be a second door onto an army roll, which is precisely the bug this
   * function exists to make impossible -- a call site that answers "who rolls" and
   * forgets "what modifies it" has no symptom at all.
   */
  against?: ArmyRef,
): ArmyRollInput {
  const modifiers: Modifier[] = []
  for (const effect of state.effects) {
    // The Temple (v2 Phase 7e): an opponent's death spell on the holder's army does
    // nothing while the capture stands. Skipped here rather than revoked, so it bites
    // again the roll after the capture is lost.
    if (templeShields(state, effect, player, ref)) continue
    if (targetsArmy(effect, player, ref)) modifiers.push(...sourced(effect))
    else if (targetsTerrain(effect, ref, 'all_armies')) modifiers.push(...sourced(effect))
    else if (against !== undefined && targetsTerrain(effect, against, 'attackers')) {
      modifiers.push(...sourced(effect))
    }
    // `'maneuverers'` is deliberately absent: Wall of Thorns fires on an event rather
    // than on a roll, and is read at the maneuver site by `thornsAt`.
  }
  if (doublesIds(state, player, ref)) modifiers.push(doubleIdsModifier(resultType))
  // The bench (`CombatState.benched`): Foul Stench's dice sit out the counter-attack
  // (v2 Phase 7d), Charm's the save roll (8d). Read here and nowhere else.
  const benched = state.turn.combat?.benched ?? []
  const units = armyOf(state, player, ref).filter(
    (unit) => !sitsOutArmyRoll(state, unit.id) && !benched.includes(unit.id),
  )
  modifiers.push(...abilityPermissions(state, units, ref, resultType))

  return { units, modifiers }
}

/**
 * The species abilities that are a "counts as" (v2 Phase 6c): the element a terrain
 * must contain for each, and the permission it grants.
 *
 * Each rides the modifier list for the reason the Death breath does: that reaches every
 * roll the ability belongs in without a call site learning about it, and `conversionsIn`
 * decides per roll whether it applies -- on a counter-attack, in a roll that counts the
 * type, as a trade. Each names the species whose dice convert (v2 Phase 1), because a
 * mixed army's other dice do not.
 *
 * - **Flaming Shields** (v1 Phase 8): every melee roll the army makes at a fire terrain
 *   -- the attack, Wall of Thorns' roll, the dragon combination roll. Gathered on a
 *   melee roll only, which is where it has always been gathered.
 * - **Coastal Dodge** (v2 Phase 5d): gathered at a water terrain whatever the roll --
 *   the dragon's combination roll is gathered as a melee roll and counts saves too.
 * - **Mountain Mastery** (v2 Phase 6f): at an earth terrain whatever the roll; only a
 *   roll that counts maneuver and not melee applies it.
 * - **Dwarven Might** (v2 Phase 6f): at a fire terrain, on a melee roll, and applied
 *   only to a counter-attack -- Flaming Shields' row with the clause reversed.
 * - **Volcanic Adaptation** (v2 Phase 8e): Coastal Dodge's row at fire, under its own
 *   name. On a Feyland (water and fire) a mixed army of Coral Elves and Lava Elves
 *   gathers both, and `conversionsIn` keeps them apart by source, so each species'
 *   maneuver is noted under its own ability.
 */
const COUNTS_AS_ABILITIES: readonly {
  readonly ability: AbilityName
  readonly element: Element
  readonly meleeRollsOnly: boolean
  readonly permission: (species: readonly string[]) => Modifier
}[] = [
  { ability: 'Flaming Shields', element: 'fire', meleeRollsOnly: true, permission: savesAsMelee },
  {
    ability: 'Coastal Dodge',
    element: 'water',
    meleeRollsOnly: false,
    permission: (species) => maneuverAsSaves(species, 'Coastal Dodge'),
  },
  { ability: 'Mountain Mastery', element: 'earth', meleeRollsOnly: false, permission: meleeAsManeuver },
  { ability: 'Dwarven Might', element: 'fire', meleeRollsOnly: true, permission: savesAsMeleeOnCounter },
  {
    ability: 'Swamp Mastery',
    element: 'earth',
    meleeRollsOnly: false,
    permission: (species) => meleeAsManeuver(species, 'Swamp Mastery'),
  },
  {
    ability: 'Volcanic Adaptation',
    element: 'fire',
    meleeRollsOnly: false,
    permission: (species) => maneuverAsSaves(species, 'Volcanic Adaptation'),
  },
]

/**
 * The "counts as" permissions these dice carry, standing at `ref`.
 *
 * `'unit'` is a unit roll: "species abilities are applied to both army rolls and when a
 * unit is rolling individually" (p. 28). Every row is gathered there and the roll's
 * own kinds decide -- a Coral Elf at water rolling saves against a Bullseye dodges.
 */
function abilityPermissions(
  state: GameState,
  units: readonly UnitInstance[],
  ref: ArmyRef,
  roll: ResultType | 'unit',
): readonly Modifier[] {
  const out: Modifier[] = []
  for (const row of COUNTS_AS_ABILITIES) {
    if (row.meleeRollsOnly && roll !== 'melee' && roll !== 'unit') continue
    if (!terrainHas(state, ref, row.element)) continue
    const species = speciesIn(units.filter((unit) => unitHasAbility(state.ruleSet, unit, row.ability)))
    if (species.length > 0) out.push(row.permission(species))
  }
  return out
}

/** What a *unit* roll needs: the die, whether it may be rolled at all, and everything
 *  modifying it. `armyRoll`'s sibling, and deliberately not its subset. */
export interface UnitRollInput {
  readonly unit: UnitInstance
  /** Sleep, Hypnotic Glare: "cannot be rolled". A unit that cannot be rolled generates
   *  nothing at all, which for Phase 4d's sub-rolls means it fails whatever it was asked
   *  to roll. A *glaring* die is rollable here -- see `Effect.glaring` -- and the roll
   *  ends its glare (`endGlaresOf`). */
  readonly rollable: boolean
  readonly modifiers: readonly Modifier[]
}

/**
 * The one door a single unit's roll goes through: Phase 4d's sub-rolls, and whatever
 * later phase rolls one die on its own.
 *
 * It gathers **only unit effects** -- never an army effect, never the eighth face's ID
 * doubling. That is *Roll Modifiers* (full rules p. 28) in code rather than in a
 * comment: "modifiers that affect an army do not affect the roll of an individual unit
 * from that army", which is why the army door is named `armyRoll` and this one is not
 * a call into it. A Galeforced army's minus four must not reach a Smother's maneuver
 * roll, and the only way to be sure of that is for the two gatherers to share nothing
 * but the species abilities, which are not modifiers on an army: "species abilities
 * are applied to both army rolls and when a unit is rolling individually" (p. 28), and
 * the unit's own abilities at its own terrain are gathered here too (v2 Phase 6c).
 *
 * No effect in the game carries a unit modifier yet -- Sleep is a status, not
 * arithmetic -- so the effect loop finds nothing today, and `modifiers` holds only the
 * unit's ability permissions. The loop is written anyway, because leaving it out
 * becomes a lie the first time a spell modifies one die, and silently.
 *
 * **No `resultType` parameter**, unlike `armyRoll`, which needs one only to build the
 * eighth face's `doubleIdsModifier`. A unit roll never gathers that, so the argument
 * would have had no reader -- the same answer 4a gave to threading a rung through
 * `SaiHandler`.
 */
export function unitRoll(state: GameState, unitId: UnitId): UnitRollInput {
  const unit = state.units[unitId]
  if (unit === undefined) throw new Error(`no such unit ${unitId}`)

  const modifiers: Modifier[] = []
  for (const effect of state.effects) {
    if (targetsUnit(effect, unitId)) modifiers.push(...sourced(effect))
  }
  // Its own species' abilities, at the terrain *it* stands on (v2 Phase 6c): none in
  // Reserves, and none in the DUA, where Fire breath's burial check rolls its dead.
  // An ability is not an army modifier, so p. 28's wall between the two does not stop
  // it -- the rules apply abilities "when a unit is rolling individually" by name.
  const where = armyRefOf(state, unitId)
  if (where !== null) modifiers.push(...abilityPermissions(state, [unit], where, 'unit'))

  return { unit, rollable: !cannotRoll(state, unitId), modifiers }
}

/**
 * How many of this army's dice Flashfire lets its owner re-roll in one roll.
 *
 * Summed across separate castings, the same arithmetic `thornsAt` does and for the
 * same reason: two announcements are two spells, and both apply.
 */
export function flashfireBudget(state: GameState, player: PlayerId, ref: ArmyRef): number {
  let total = 0
  for (const effect of state.effects) {
    if (targetsArmy(effect, player, ref)) total += effect.flashfire ?? 0
  }
  return total
}

/** Accelerated Growth: whether this player's dead are exchanging rather than dying. */
export function regrows(state: GameState, player: PlayerId): boolean {
  return state.effects.some(
    (effect) => targetsPlayer(effect, player) && effect.trigger === 'accelerated_growth',
  )
}

/**
 * Wall of Thorns' damage at a terrain, or 0.
 *
 * Summed rather than taken singly: two castings of a cumulative spell on one target
 * are one spell with a bigger number, but two *separate* announcements are two spells
 * and both bite. The same arithmetic `armyRoll` does for two Galeforces.
 */
export function thornsAt(state: GameState, slot: TerrainSlot): number {
  let total = 0
  for (const effect of state.effects) {
    if (targetsTerrain(effect, slot, 'maneuverers')) total += effect.thorns ?? 0
  }
  return total
}

/**
 * Drops the effects that end at the start of this player's turn.
 *
 * **Returns the same object when it drops nothing.** `advance` loops on `stepGame`
 * until it returns the state it was handed, so an unconditional copy here is an
 * infinite loop -- a loud one, since `advance` throws after 1000 steps, but a loop.
 */
export function expireEffects(state: GameState): GameState {
  const marching = state.turn.marching
  const kept = state.effects.filter((effect) => effect.expiresAtStartOfTurnOf !== marching)
  if (kept.length === state.effects.length) return state

  const sources: string[] = []
  for (const effect of state.effects) {
    if (effect.expiresAtStartOfTurnOf === marching && !sources.includes(effect.source)) {
      sources.push(effect.source)
    }
  }
  const entry: LogEntry = { kind: 'effects_expired', player: marching, sources }

  return { ...state, effects: kept, log: [...state.log, entry] }
}

/**
 * Drops effects whose target has ceased to exist: an army with no units left, or a
 * unit that is no longer in play.
 *
 * "The effect ends if there are no units remaining in the army. This is checked at
 * the end of each action." `stepGame` runs after every action -- `applyAction` never
 * sets `pending` -- so calling it from there is that rule exactly.
 *
 * "If all the units from the army are replaced with other units as a single action,
 * the army is still considered to be present." That needs no code: `exchangeWithDua`
 * resolves in one pass, so no state in which the army is empty is ever observed.
 *
 * Same-object rule as `expireEffects`, and for the same reason.
 */
export function pruneEffects(state: GameState): GameState {
  const kept = state.effects.filter((effect) => {
    // An anchored effect ends when its anchor leaves the terrain or play (v2 Phase 5b),
    // whatever its target is doing: a hypnotized die stays hypnotized only while the
    // Leviathan that glared at it is still standing where it glared.
    if (effect.anchor !== undefined && !anchorHolds(state, effect.anchor)) return false
    // Exhaustive on purpose: a fifth `EffectTarget` member is a compile error here
    // rather than a silently immortal effect.
    switch (effect.target.kind) {
      case 'army':
        return armyOf(state, effect.target.player, effect.target.army).length > 0
      // A terrain cannot empty, move or cease to exist, so a terrain effect only ever
      // ends by expiring. "If an army is destroyed ... any spells affecting that army
      // end" is a rule about armies, and this is not one.
      case 'terrain':
        return true
      // A player is never gone: losing every unit ends the game rather than the
      // effect, and `stepGame` prunes before it checks for a winner.
      case 'player':
        return true
      case 'unit': {
        const unit = state.units[effect.target.unitId]
        return (
          unit !== undefined &&
          (unit.location.kind === 'terrain' || unit.location.kind === 'reserve')
        )
      }
    }
  })

  return kept.length === state.effects.length ? state : { ...state, effects: kept }
}

function anchorHolds(state: GameState, anchor: NonNullable<Effect['anchor']>): boolean {
  const location = state.units[anchor.unitId]?.location
  return location?.kind === 'terrain' && location.slot === anchor.slot
}

/**
 * Ends every effect anchored to one of these dice "until rolled", because they just were.
 *
 * Hypnotic Glare's third end condition. Only a unit roll can reach it -- a glaring die
 * sits out every army roll -- so every unit roll calls it: the SAI sub-roll, the
 * spells' save roll (v2 Phase 6c; it missed this until then) and the damage sub-roll.
 * Same-object rule as `pruneEffects`: nothing anchored there, nothing changes.
 */
export function endGlaresOf(state: GameState, rolled: readonly UnitId[]): GameState {
  const kept = state.effects.filter(
    (effect) =>
      effect.anchor?.untilRolled !== true || !rolled.includes(effect.anchor.unitId),
  )
  return kept.length === state.effects.length ? state : { ...state, effects: kept }
}
