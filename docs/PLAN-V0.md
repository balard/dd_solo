# Implementation plan — v0 alpha

Nine phases from empty repo to a playable alpha. Each has a **deliverable**, an **exit criterion**
you can actually check, and the **tests** that prove it.

Read `RULES-V0.md` for what the alpha does, and `OVERVIEW.md` §2 for why the engine is shaped this
way. This document is the *order of work*, not a re-statement of either.

**Dependencies are mostly linear**, with one fork:

```
0 Scaffold
    |
1 Engine foundations
    |
2 Rolling ---- 3 Damage          (2 and 3 are independent of each other)
    \___________/
          |
    4 Turn + maneuver
          |
    5 Actions
          |
    6 AI + headless harness
          |
    7 UI ---- 8 Alpha polish
```

Phases 2 and 3 can be done in either order. Everything else needs what precedes it.

---

## Phase 0 — Scaffold  ✅ done

**Deliverable.** Vite + TypeScript + React project, Vitest wired, strict compiler settings, the
directory split from `OVERVIEW.md` §1, and the data loading path proven end to end.

- `npm create vite` (react-ts), then strip the template down to nothing
- `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- ESLint rule (or a test) forbidding `src/engine/**` and `src/ai/**` from importing `src/ui/**`
  or `react` — invariant 2 in `CLAUDE.md` should fail CI, not just good intentions
- `src/data/load.ts` — imports the two JSON files, parses `"2 MELEE"` into `{ count, icon }`,
  throws on anything unparseable
- npm scripts: `dev`, `build`, `test`, and `data` running the three Python tools in sequence

**Exit criterion.** `npm run dev` serves a page that lists all 40 unit dice and 12 terrain dice
with their parsed faces, read from the real JSON. Ugly is fine — this is a data-pipeline smoke
test wearing a UI costume, and it is worth doing first because it catches loader and
build-config problems before any logic depends on them.

**Tests.** `load.ts` parses every face in both files without throwing; face counts per die match
`dieType`; the engine-purity lint rule fails when deliberately violated.

**Outcome.** 28 tests green, typecheck clean, page renders all 52 dice with no console errors and
no horizontal overflow at 375px. Two things learned:

- The purity check is a *tested pure function* (`findViolations`) applied to the real tree, not an
  ESLint rule — no plugin dependency, and it is verified against deliberate violations. It must
  skip `*.test.ts`, since test fixtures legitimately contain the very strings it forbids.
- `Face` is a discriminated union rather than an optional `sai?: string`, which
  `exactOptionalPropertyTypes` makes awkward to construct and which would let callers read `.sai`
  without narrowing.

---

## Phase 1 — Engine foundations  ✅ done

**Deliverable.** The types, the RNG, the reducer skeleton, and a constructible initial state.

### Location-derived armies

Do **not** model Home/Campaign/Horde as tracked entities. Give each unit a location and derive
armies by query:

```ts
type Location =
  | { kind: 'terrain'; slot: TerrainSlot }
  | { kind: 'reserve' }
  | { kind: 'dua' }

type TerrainSlot = 'p1_home' | 'frontier' | 'p2_home'
```

An army is then "player P's units at slot S", and the Reserve Army is "player P's units in
reserve". This removes a whole class of desync bugs, and it makes the two-march rule fall out
naturally: the second march must use a different slot (or reserves) than the first. Home, Campaign
and Horde become *setup* vocabulary, not runtime state.

### The reducer auto-advances

```ts
reduce(state: GameState, action: GameAction): GameState
```

After applying an action, `reduce` runs an internal loop advancing through every step that requires
no decision — rolling dice, computing totals, moving to the next phase — and stops only when it
hits a decision or the game ends. Each intermediate step appends to `state.log`.

This is what lets the UI animate a melee exchange (attack roll → saves → damage) from the log while
the engine treats it as one transition. It also means a future SAI with a delayed effect becomes a
new stopping point rather than a restructure.

### Pending

```ts
type Pending =
  | { kind: 'choose_march_army';  player: PlayerId; options: MarchOption[] }
  | { kind: 'choose_maneuver';    player: PlayerId; slot: TerrainSlot }
  | { kind: 'contest_maneuver';   player: PlayerId; slot: TerrainSlot }
  | { kind: 'choose_direction';   player: PlayerId; slot: TerrainSlot }
  | { kind: 'choose_action';      player: PlayerId; slot: TerrainSlot; legal: ActionKind[] }
  | { kind: 'choose_missile_target'; player: PlayerId; options: TerrainSlot[] }
  | { kind: 'choose_counter_attack'; player: PlayerId; slot: TerrainSlot }
  | { kind: 'assign_damage';      player: PlayerId; slot: TerrainSlot; damage: number }
  | { kind: 'reinforce' | 'retreat'; player: PlayerId }
```

A discriminated union, not `options: unknown` — the sketch in `OVERVIEW.md` §2 was shorthand. The
UI and the AI both exhaustively switch on `kind`, so adding a decision later is a compile error
everywhere it needs handling. That is the point.

### Also in this phase

- **Seeded PRNG** with `{ seed, counter }` in state. A small integer hash (mulberry32 or
  splitmix32) — do not reach for a library, and never call `Math.random` anywhere in `src/engine`.
- **`data/presets.json`** — two hand-authored 30-health army lists, split into three armies of
  ≤ 15 health each. Hand-authored content, not generated; the importers must not touch it.
  Terrains per `RULES-V0.md` §7: Treefolk bring Swampland, Firewalkers bring Wasteland, Highland
  is each side's proposed Frontier.
- **`setupGame(seed, presets)`** producing a legal initial `GameState`.

**Exit criterion.** `setupGame` returns a state that passes a `validateState` invariant checker:
every unit in exactly one location, army health totals matching the presets, terrains on faces 1–6.

**Tests.** Same seed → identical state. Different seed → different terrain start faces.
`validateState` rejects hand-corrupted states (unit in two places, terrain on face 7 at setup).

**Outcome.** 65 tests green, typecheck clean. Notes for later phases:

- **One deliberate gap.** The Horde roll-off that decides who goes first needs `rollArmy`, which
  is Phase 2. Until then `setupGame` takes `firstPlayer` as a parameter. The *other* setup choice
  — which proposed Frontier is used — resolves itself, because both preset forces propose
  Highland; `setupGame` throws if a future pair of presets disagrees rather than silently picking.
- **Location-as-single-source-of-truth paid off immediately.** "Every unit is in exactly one
  place" is now structurally impossible to violate, so `validateState` does not check it. What it
  checks instead is the pair that *can* drift: `face === 8` and `capturedBy !== null` must agree,
  since letting them separate would silently break both the win check and the revert-to-7 rule.
- **The RNG uses rejection sampling, not modulo.** A plain modulo skews toward low faces — the
  kind of unfairness nobody notices and everybody eventually suspects. There is a chi-square
  uniformity test over 60k rolls for both d6 and d10.
- **`advance` has a step budget** (1000) that throws rather than hanging. A pure reducer that
  fails to reach a decision would otherwise lock the UI with no diagnosis; the Phase 6 fuzzer
  exists precisely to provoke this.

---

## Phase 2 — Rolling  ✅ done

**Deliverable.** `rollArmy(units, resultType, rng): RollResult`.

**This is smaller than the rules make it sound.** The rulebook gives two special cases — an ID icon
generates health-worth of results, and monster icons count as four — and *the data already encodes
both*. Verified across all 280 faces: every ID face's count equals its unit's health, and every
normal monster face's count is 4. So:

```
sum the count of every rolled face whose icon matches the result type,
counting ID as matching everything, and SAI as matching nothing (ruleSet.sai === 'inert')
```

No multipliers, no size lookups, no branching on monster. If you find yourself writing
`if (unit.size === 'monster')` in the roller, stop — the data is doing it for you.

`RollResult` must keep the per-die faces, not just the total, because the UI shows the dice and the
log needs to reconstruct the roll.

**Exit criterion.** Rolling a known army with a fixed seed produces a hand-checked total.

**Tests.** An ID face contributes exactly `health` for all five result types. An SAI face
contributes 0. Property test: for any army and result type, `0 ≤ total ≤ sum of max face counts`.
Worked example — the Firewalker `Guardian` (`1 ID`, `1 MELEE`, `1 SAVE`, `1 MISSILE`, `2 MELEE`,
`1 MANEUVER`) rolling melee yields exactly one of `{1, 1, 0, 0, 2, 0}`.

**Outcome.** 93 tests green. `faceResults` is three lines, as predicted — no multiplier, no size
lookup, no monster branch. A test asserts that across all 280 faces.

- **SAIs throw rather than return 0 when `ruleSet.sai === 'full'`.** A half-enabled ruleset should
  fail loudly, not quietly play a wrong game.
- **The Phase 1 gap is closed.** `setupGame` now runs the Horde roll-off when `firstPlayer` is
  omitted, threading one RNG stream in rules order (roll-off, then terrain faces). Ties reroll,
  with a coin flip after 50 attempts so tiny armies cannot spin forever.
- **Measured army output** (4000 rolls per army, starter presets):

  | | melee | save | maneuver | magic |
  |---|---|---|---|---|
  | Treefolk home | 4.9 | 4.3 | 2.3 | 2.8 |
  | Firewalkers home | 4.0 | 3.0 | 3.5 | 3.2 |

  Treefolk are measurably tankier and Firewalkers more mobile, which is what the dice look like.
  More importantly this is the first hard evidence on the magic house rule — see below.

**Magic looks weak.** Army magic averages 1.6–3.2, so `floor(M / 2)` is typically **0–1 damage**,
while a melee action averages ~4.5 against ~3 saves for ~1.5–2 damage plus a counter-attack. Magic
is the low-output, low-risk option — defensible, but thin. Combined with Highland carrying three
magic faces, Highland will play very slowly. Worth revisiting `floor` vs `ceil` (`RULES-V0.md`
section 8) once Phase 5 makes it playable; these are dice averages, not playtest results.

---

## Phase 3 — Damage  ✅ done

**Deliverable.** The rule most likely to be built wrong. Write the tests first.

```ts
maxAbsorbable(healths: number[], damage: number): number
isMaximalAssignment(healths: number[], damage: number, chosen: number[]): boolean
```

`maxAbsorbable` is a subset-sum DP over achievable totals ≤ damage — O(n · damage), trivially fast.
**Do not enumerate all maximal subsets.** Enumeration is exponential in the worst case and produces
a list the UI cannot usefully render. Instead the damage sheet lets the player toggle units and
shows `absorbed 4 / must reach 5`, with confirm disabled until `sum(chosen) === maxAbsorbable(...)`.
Better UX, cheaper algorithm.

The reducer rejects any assignment failing `isMaximalAssignment`, including one with a legal sum
that is not maximal.

**Exit criterion.** Every case below passes.

**Tests.**

| Damage | Army healths | Expected |
|---|---|---|
| 5 | 3, 2, 2, 1 | max 5; `{3,2}` and `{2,2,1}` legal; `{3}` rejected |
| 4 | 3, 3 | max 3; either single 3; `{}` rejected |
| 2 | 3 | max 0; nothing dies, damage ignored |
| 10 | 3, 2 | max 5; army wiped |
| 0 | anything | no `assign_damage` decision raised at all |

**Outcome.** 121 tests green.

- **Greedy is wrong, and it was worth proving.** Largest-first *looks* correct and passes most
  cases, but 4 damage against 3, 2, 2 makes it take the 3, strand a point, and stop at 3 — while
  `{2, 2}` absorbs the full 4. Hence the DP with reconstruction, plus a test named after exactly
  this trap and an exhaustive brute-force cross-check over all 2⁷ subsets for damage 0–18.
- **Which maximal set to kill is strategy, not rules.** The surviving *health* is identical across
  every maximal set (it is always `total − maxAbsorbable`), but the surviving *number of dice* is
  not — and more dice generally means more results. `chooseMaximalSubset` returns a deterministic
  legal answer for the AI and an auto button; the real choice belongs to the player. A preference
  heuristic is a Phase 6 concern.
- **`applyDamage` deliberately does not check for victory.** The win check runs after every state
  change, not only after damage, so it belongs to the caller in Phase 4.

---

## Phase 4 — Turn structure and maneuver  ✅ done

**Deliverable.** A turn you can play end to end with no attacks.

- Phase sequence per `RULES-V0.md` §3, including the three no-op phases (Effects Expire, Eighth
  Face, Dragon Attack). **Implement them as real no-op phases**, not as omissions — they are where
  v1 features land, and leaving holes now means restructuring later.
- March selection, enforcing "second march uses a different army".
- Maneuver: declare (direction hidden) → opponent contests or allows → contested roll, marcher wins
  ties → direction chosen → terrain moves one face.
- Capture on reaching face 8; revert to 7 on abandon, out-maneuver, or army wiped.
- Win check after **every** state change: two captures, or an opponent with no units in play.
- Reserves Phase: Reinforce then Retreat.
- A Reserve Army cannot march (`RULES-V0.md` §3) — it has no legal maneuver and no legal action.

**Exit criterion.** A scripted game of pure maneuvering reaches a capture win.

**Tests.** Terrain at 7, uncontested maneuver up → captured. Contested, marcher ties → marcher
wins. Captured terrain, opponent out-maneuvers → back to 7, capture lost. Second capture → `winner`
set immediately, not at end of turn. Marching the same army twice is rejected.

**Outcome.** 152 tests green, and a throwaway random-play fuzz over 120 games (~134k decisions)
produced zero `validateState` violations and zero crashes. 18 of those games reached a capture win
by maneuvering alone, so the win path holds under random play and not just under a script. The
other 102 hit the step cap, which is expected: with no combat, random maneuvering is a drunkard's
walk across the terrain faces. Phase 6 formalises this as `RandomAI`.

- **The load-bearing split:** `applyAction` folds in a decision and *always clears* `pending`,
  never setting one; `stepGame` is the only thing that sets `pending`. Because an action leaves
  `pending` null, the advance loop always runs `stepGame` at least once afterwards — which is
  precisely what makes the victory check run after every state change instead of at end of turn.
  Getting this backwards would have made `advance` return early and skip the check.
- **Maneuvering is three steps, not one.** Declare → contest → direction, because the rules make
  the opponent decide whether to contest *without* knowing which way the terrain is going.
  Collapsing them would leak the direction. There is a test asserting the pending decision
  contains no direction while the contest is open.
- **`Phase` gained `reserves_reinforce` / `reserves_retreat`** instead of one `reserves` phase, so
  the sub-step needs no extra field on `TurnState`.
- **`choose_direction` carries its legal options,** since face 1 cannot go down and face 8 cannot
  go up.
- **Phase 5's `choose_action` is offered with `legal: []`** and rejects any non-null action. An
  empty list is an honest contract; offering `['melee']` and then throwing would be a lie that the
  Phase 6 fuzzer would trip over immediately.

---

## Phase 5 — Actions  ✅ done

**Deliverable.** Melee, missile and magic, gated by the terrain's current face.

- Terrain face → legal action. Faces 1–7 carry exactly one of melee/missile/magic, so `legal` is
  usually a single entry; keep it an array for the v1 eighth-face case where the controller picks.
- **Melee**: attack roll → saves → damage → `choose_counter_attack` → counter roll → saves →
  damage. A defending army reduced to zero units does not counter.
- **Missile**: attack → saves → damage. No counter. Cannot target Reserves, and not from one Home
  Terrain to the other.
- **Magic** (`RULES-V0.md` §4): same terrain only, `floor(total / 2)` damage, no save, no counter.
  Behind `ruleSet.magic === 'simplified'`.

Keep `magicDamage()` a named function taking the ruleset. Flipping to real spells should change one
call site, and the `floor` vs `ceil` question in `RULES-V0.md` §8 should be a one-line change.

**Exit criterion.** Scripted combat scenarios produce hand-computed damage.

**Tests.** `7 melee − 3 saves = 4 damage`. Zero attack results → no save roll raised at all.
Counter-attack damages the marcher. Missile raises no counter. Magic of 7 → 3 damage, no save
decision raised for the defender. A magic action is illegal from reserves.

**Outcome.** 176 tests green. A random-play fuzz over 300 complete games with combat live produced
zero `validateState` violations; 205 reached a result (185 by elimination, 20 by capture) and 95
hit the decision cap.

- **`legalActions` returns `[]` when there is nothing to hit,** not just when the face forbids the
  action. Melee and magic need an opposing army at the same terrain; missile needs a reachable
  target. The empty list is how the engine says "you may only pass".
- **A zero attack makes no save roll at all,** rather than a save roll against 0. `saveTotal` is
  `null` in that case and no randomness is consumed — which also keeps replays stable.
- **Damage that cannot kill anything is dropped rather than asked about.** If `maxAbsorbable` is
  0, no `assign_damage` decision is raised at all, matching "if a die takes less damage than it
  has health, the damage is ignored".

**Magic is less weak than Phase 2's arithmetic suggested.** At full strength melee averages 3.48
results → 1.45 damage after saves, while magic averages 2.22 → 0.96 damage with no save allowed.
So magic delivers about two thirds of melee's damage *and* takes no counter-attack in return —
a defensible trade rather than the near-uselessness predicted from dice averages alone. The
Phase 2 note overstated it, because it compared magic's raw total against melee's raw total
without accounting for saves eating most of melee's advantage.

**Game length is the real open question.** Random play averages 314 turns, which is wildly longer
than a real game. Treat that as an upper bound rather than a prediction: a random agent maneuvers
aimlessly, splits its force, and attacks with whatever happens to be adjacent, while a human
concentrates force and picks favourable fights. The 185:20 split of elimination over capture wins
has the same cause — random play almost never maneuvers a terrain the same way often enough to
take it. Worth re-measuring in Phase 6 against `GreedyAI`, and only then deciding whether anything
needs tuning.

---

## Phase 6 — AI and the headless harness  ✅ done

**Deliverable.** Two AIs, for two different jobs.

**`PassiveAI`** — the alpha opponent. Takes no initiative: skips every march, never contests a
maneuver, never reinforces or retreats. But it is **not inert** — it answers every decision forced
on it, and it *does* counter-attack, which is free and exercises that path. "Passive" means "starts
nothing", not "never acts". A genuinely inert opponent would leave half the combat code untested.

**`RandomAI`** — a test tool, not an opponent. Picks a uniformly random legal action at every
decision. Self-play (`RandomAI` vs `RandomAI`) over thousands of seeded games is the cheapest bug
detector available here: it will find illegal states, unreachable phases, infinite loops and
crashes far faster than hand-written scenarios.

Both implement one interface so they are interchangeable with a human.

**Exit criterion.** A headless runner plays a full game to a winner, deterministically from a seed.
1000 `RandomAI` self-play games complete with no crash and no `validateState` violation.

**Tests.** Self-play fuzz as above, run in CI with a fixed seed range. Replaying a recorded action
log reproduces the final state exactly — this is the determinism guarantee, and it is worth an
explicit test because everything downstream (save/load, undo, bug reports) rests on it.

**Worth considering here:** a tiny CLI that plays a game in the terminal, before any React exists.
It costs little on top of the headless runner and lets you feel the rules — especially the magic
house rule — while the UI is still weeks away. Recommended, but skippable.

---

## Phase 7 — UI  ✅ done

**Deliverable.** The screens from `OVERVIEW.md` §6. Engine-driven throughout: the UI renders
`state.pending` and dispatches actions. **No component holds wizard state.**

Order, most load-bearing first:

1. **Result glyphs** — our own SVGs for the six result types, legible at 24px, in both themes.
   Everything else depends on these existing.
2. **Dice grid** — wrapping grid of ~44px tiles, size indicator plus face glyph, selectable.
3. **Terrain focus view** — one terrain, two armies, full width. Where play happens.
4. **Board strip** — three terrains, ~80px tall, always visible: face number, action icon,
   per-side strength.
5. **Action bar** — driven entirely by `state.pending`: one sentence saying what the game wants,
   and only the legal choices.
6. **Damage sheet** — tap to toggle, live `absorbed 4 / must reach 5`, confirm disabled until
   maximal. The hardest rule gets the most guided screen.
7. **Roll results** — show the dice and the arithmetic (`7 melee − 3 saves = 4 damage`) before
   advancing. Players need to trust the math, and this is also how they learn the rules.

**Exit criterion.** A full game start to finish against `PassiveAI` at 375px wide, without reading
the rulebook to understand what the app is asking for.

**Tests.** Component tests for the damage sheet's maximal-selection gating. The engine is already
covered; do not re-test rules through the DOM.

**Outcome.** 203 tests green. A full game plays in the browser at 375px with no horizontal
overflow and no console errors.

- **The dice grid *is* the selection surface.** Assigning damage, retreating and reinforcing all
  reuse the same tappable grid rather than each getting a modal — selecting units to lose is the
  same gesture as looking at them.
- **The gating became a pure function instead of a component test.** `damageSelection(state,
  pending, selection)` returns `{ absorbed, required, ready, suggestion }`, so the rule the confirm
  button exists to enforce is tested without adding jsdom and testing-library, and the component
  renders it while deciding nothing. This is a deliberate deviation from the plan's "component
  tests", and a better shape: logic that matters should not need a DOM to verify.
- **The combat log now carries the dice, not just the totals.** `combat_resolved` gained
  `attackDice` / `saveDice` so the UI shows what landed before the arithmetic. It costs nothing on
  disk, because a saved game is `{ setup, actions }` and the log is derived.
- **The selection is cleared whenever the pending decision changes.** A half-made selection is a
  draft answer to one question; it is meaningless against the next one.
- **The focused terrain follows the game** unless the player deliberately taps another, and a new
  decision about a different terrain takes the focus back.

---

## Phase 8 — Alpha polish  ✅ done

**Deliverable.** Something you can install and come back to.

- PWA manifest, service worker, installable on an Android home screen
- **Persistence: save the seed and the action log, not the state.** A few KB, and it doubles as a
  bug report you can replay.
- New game, resume, abandon
- A visible seed, so a broken game is reproducible
- Loading and error states for a corrupt or outdated save

**Exit criterion.** Install to a phone home screen, play, close, reopen, resume mid-turn.

**Outcome.** 216 tests green. Verified in the built app: playing six moves, reloading, and coming
back to the *same* pending decision with the same board and seed, announced by a "Resumed your
saved game" banner. A six-move save is **406 bytes**.

- **A save is the record, never a snapshot.** `{ setup, actions }` replayed on load. It stays a few
  KB however long the game runs, it doubles as a bug report, and it cannot disagree with itself the
  way a serialised state could.
- **`SAVE_VERSION` guards against the rules moving underneath a save.** A version mismatch is
  discarded with an explanation rather than replayed into a subtly wrong game. Bump it whenever a
  change would make old action logs replay differently.
- **Replay is wrapped in a try/catch anyway.** A well-formed save can still fail if a decision that
  was legal last week no longer is; that is recoverable, not a crash. Corrupt, outdated and
  unreplayable saves all land on "started a new game — *reason*", verified live.
- **Every `localStorage` access is wrapped.** Private windows, blocked site data and full quotas
  all throw. A game that cannot be saved still has to be playable, and the UI says so plainly.
- **An error boundary shows the seed and move count** when something does crash, with the record
  available to copy — because a game *is* its record, that is enough to reproduce any failure.

**Not verified here: service-worker registration.** The embedded browser pane refuses to register
one (`sw.js` serves correctly at 200 with the right content type; registration fails with "an
unknown error occurred when fetching the script"). The manifest, icons, theme colour and the
15-entry precache manifest are all generated and served correctly. Installing and offline use need
checking in a real browser.

---

## Definition of done for the alpha

- A full game is playable start to finish against `PassiveAI` on a phone
- Both win conditions reachable: two captures, and elimination
- 1000-game self-play fuzz passes clean
- Damage assignment cannot be completed with a non-maximal selection
- Replaying a saved action log reproduces the game exactly
- No `Math.random` and no React import anywhere under `src/engine/`

## Risks

**Phase 7 is the one that will overrun.** Phases 1–6 are well-specified with clear exit tests;
the UI is where "playable" and "pleasant" diverge and taste starts costing time. The headless CLI
in Phase 6 is the hedge — it makes the rules playable before the UI is, so a slow Phase 7 delays
polish rather than blocking all feedback.

**The magic house rule is untested game design.** `floor(M / 2)` with no save and no counter may
land anywhere between useless and dominant, and the terrain split makes it uneven across dice —
Wasteland has one magic face, Highland three (`RULES-V0.md` §5). Expect to tune it, which is
exactly why it is a named function behind a ruleset flag.

**Preset armies are a guess.** Two fixed 30-health lists chosen before anyone has played a game.
Treat them as a starting point, not a balance decision.

## Not in this plan

Everything in `RULES-V0.md` §2, in the order it comes back: SAIs → eighth-face powers → spells →
dragons. Each is a `RuleSet` flag with a home already prepared, which is the whole reason the no-op
phases and the recorded-but-inert SAI data exist.
