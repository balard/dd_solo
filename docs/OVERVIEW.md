# dd_solo — project overview

A solo-play app for **Dragon Dice** (SFR, Inc.). You command one side; the app runs the board,
the dice and the opponent.

Release target for v1.0 is the **Kickstarter starter set**: Treefolk vs Firewalkers.
The alpha is a deliberately reduced version of that — see `RULES-V0.md` for the exact subset.

---

## 1. Technology

**TypeScript + Vite + React, shipped as a PWA.**

The decision that actually matters is not React — it is the **hard split between the rules engine
and the UI**:

```
src/engine/    pure TypeScript. No React, no DOM, no I/O, no Math.random.
src/ai/        pure TypeScript. Depends on engine types only.
src/ui/        React. Depends on engine. Engine never depends on this.
data/          JSON die data + schemas. Content, not code.
```

React is a good default here (largest ecosystem, best mobile tooling, everyone including future-you
can read it), but it is genuinely swappable because it owns nothing but presentation.

**Why a web app first, and why that isn't a dead end:** a Vite PWA is installable on Android and
iOS home screens today, needs no store review, and updates instantly. When an APK is wanted,
**Capacitor** wraps the exact same `dist/` into a native shell — no rewrite, no second codebase.
So "HTML now, APK later" is one build pipeline with an extra step, not a migration.

Supporting choices, all cheap to revisit:

| Concern | Choice | Reasoning |
|---|---|---|
| Test runner | Vitest | Same config as Vite; the engine is the part that needs heavy testing |
| State binding | Zustand (or plain `useReducer`) | The engine *is* the state machine; the store is a thin subscription layer over it |
| Styling | CSS Modules or Tailwind | Either is fine; decide when the first screen is built |
| Persistence | `localStorage` | Serialize the action log, not the state (see §2) |
| Dice art | Our own SVG glyphs | We cannot ship SFR's icon art (§5) |

## 2. Architecture — the engine

### The engine is a pure reducer

```ts
reduce(state: GameState, action: GameAction): GameState
```

No side effects, no clocks, no ambient randomness. Everything else follows from this:

- **Determinism.** The RNG is a seeded PRNG whose seed *and counter* live inside `GameState`.
  Replaying the action log reproduces a game exactly, die for die.
- **Testing.** Rules tests are a list of actions and an expected state. No mocking.
- **Save/load and undo are free.** Persist the seed plus the action log — a few KB — and replay.
- **The AI is not special.** It is a function `(state) => action` feeding the same reducer as
  the human. Nothing in the engine knows which side is which.
- **Hotseat and networked play cost nothing later**, because they are just other action sources.

### Rolls are multi-step, not atomic

A melee attack is not one call. It is: attacker rolls → defender rolls saves → defender assigns
damage → defender counter-attacks → attacker rolls saves → attacker assigns damage. Each hop is a
state where the engine is blocked on **a specific decision from a specific player**.

So the state carries an explicit pending decision:

```ts
type Pending = {
  player: PlayerId
  kind: 'choose_march_army' | 'choose_maneuver' | 'contest_maneuver' | 'choose_action'
      | 'choose_target' | 'assign_damage' | 'reinforce' | 'retreat' | ...
  options: unknown   // shape depends on kind
}
```

This is the single most load-bearing type in the project. It gives us:

- a **UI that is a pure function of `state.pending`** — the screen always knows exactly what it is
  asking for, instead of tracking its own wizard state;
- an **AI that is a `switch` over `pending.kind`**, which is what makes "the alpha AI does nothing"
  actually implementable (§4);
- **legal-move enumeration for free**, which is what a stronger AI will later search over.

### Damage assignment is a real algorithm

See `RULES-V0.md` §6. Damage does not reduce hit points — it kills a maximal-sum subset of units,
and the *defender* chooses which. `legalDamageAssignments(army, damage)` enumerates the maximal
subsets; the reducer rejects anything else. Brute force over ≤ 12 dice is entirely fine.

This is the rule most likely to be implemented wrong by reflex, so it gets tests first.

### Scope lives in a ruleset config, not in `if` statements

```ts
interface RuleSet {
  magic: 'simplified' | 'spells'       // v0: 'simplified' — RULES-V0.md §4
  sai: 'inert' | 'full'                // v0: 'inert' — SAI faces roll as zero results
  eighthFace: 'captureOnly' | 'full'   // v0: 'captureOnly' — capture wins, no icon powers
  dragons: boolean                     // v0: false
}
```

The v0 → v1 ladder then has a concrete shape: each flag flipped is a milestone, and the cut
features have a named home before anyone writes them. It also keeps the alpha's house rules
from being quietly welded into the engine.

## 3. Data

Die faces are **content**, in `data/`, validated at build time. A face correction never touches
engine code, and a typo fails the build rather than producing a subtly wrong game.

```
data/raw/<species>.faces.txt   source of truth, hand-transcribed
        |  tools/import_faces.py
data/starter/units.json        generated -- never hand-edited
        |  tools/validate_data.py
        pass / fail
```

### A face is a count of icons

The single most important thing the data model gets right. A face is **not** one icon — it carries
a count, and that count is what it generates. The Firewalker Guardian, a 1-health small unit, has
a face reading `2 MELEE`. Counts broadly scale with size (monsters are always 4), but not by any
formula you can rely on — the Treefolk `Oak`, 2 health, carries a `4 SAVE` face. Modelling a face
as a single result would make every damage number in the game wrong. See `data/ICONS.md`.

SAI faces carry a count too, but it is not always a result count — for targeting SAIs it is the
SAI's X parameter (`2 SAI:Flame` targets two health-worth of units). Each SAI interprets its own
number.

### Where the data comes from

Neither rulebook contains machine-readable faces — the species pages show each unit's *class*, not
its six faces. `dragondice.com`'s Dice Browser is session-bound PHP AJAX that returns nothing
without a live session, and `commander.dragondice.com` keeps its die data behind an authenticated
API (`/api/me` → 401). Its face *art* is public and unauthenticated, but art alone does not tell
you which face is on which die. So faces get transcribed by hand, once.

The raw format is close to what Dice Commander displays, so transcription is mostly copy-paste:
a die header, then one `<count> <Icon>` line per face.

**Status:**

| | |
|---|---|
| Firewalkers | **complete** — 20/20 dice, 140 faces |
| Treefolk | **complete** — 20/20 dice, 140 faces |
| Terrains | **complete** — 3 types × 4 eighth-face variants = 12 dice |

Both species pass validation. A useful independent check fell out of having both: the data uses
exactly 25 distinct SAIs, and the starter rulebook documents exactly those 25 — no unknown names,
none unused. The two species overlap on only three (Cantrip, Counter, Smite), so agreement across
both transcriptions is unlikely to be coincidence.

The terrain data was the one worth not guessing. A terrain die turns out to be a **type** (fixing
faces 1–7) plus an **eighth-face icon** (City, Standing Stones, Temple, Tower) — so the model is a
product of two axes, not a flat list. And while every type runs magic → missile → melee as the
number rises, **the split points differ per type**: Wasteland has one magic face, Highland has
three. That difference is most of what distinguishes the dice, and no amount of reasoning from the
rulebooks would have produced it.

### Reference art

`tools/fetch_faces.py` mirrors the real SVGs for every face our data references into
`assets/faces/` (gitignored). The remote asset set is **sparse, per-species, and not derivable from (icon, count)**. It mirrors
exactly the faces that species actually has: `treefolk/save-4.svg` and `treefolk/magic-4.svg` exist
because Treefolk dice carry those faces, while the same paths under `firewalkers/` are 404 because
no Firewalker die does. Some icons also carry a variant index (`maneuver-1-4`, `cantrip-1-3`,
`trample-1-m` vs `trample-2-m`), and monster faces use a `-m` suffix. So the fetcher tries a
fallback chain per face rather than computing a filename.

A useful consequence: **the asset listing is a weak independent oracle for the face data.**
Probing which `<species>/<icon>-<n>.svg` exist tells you which (icon, count) pairs appear somewhere
in that species — not which die carries them, but enough to catch an invented or mistyped count.

## 4. The AI

A ladder, because the interesting version needs the boring version's interface first:

- **v0 — `PassiveAI`.** Never takes a march, never maneuvers, never attacks. But it is *not* a
  no-op: it must still answer every mandatory pending decision — save rolls, damage assignment
  (maximally, per the rules), counter-attacks. This is exactly enough to test the whole loop, and
  it proves the `Pending` abstraction works before any strategy exists.
- **v1 — `GreedyAI`.** Heuristic scoring over enumerated legal actions: expected damage, terrain
  progress, army health preserved.
- **v2 — search.** Genuinely tractable here, unlike most games: every die's face distribution is
  fully known and tiny, so the expected results of any roll are computable in closed form rather
  than sampled. An expectimax over one or two plies is realistic.

Keep `AiPlayer` as an interface from day one so all three are drop-in.

## 5. Legal and asset position

This is a fan-made solo aid for a game we own. Worth being deliberate about:

- **Do not ship SFR's icon art, unit art, or dice imagery.** Draw our own simple SVG glyphs for
  the six result types. They need to be legible at 24px anyway, which the real art is not.
- The real SVGs are publicly served and can be mirrored locally as **development reference**
  (`tools/fetch_faces.py`, gitignored). Using them in a personal build is your call; bundling them
  in anything distributed is not. Keep them behind a glyph-lookup indirection so swapping art is a
  config change. Do not hotlink them at runtime — it breaks offline use and depends on paths they
  are free to change.
- Die face *data* is factual game information, but unit and species names are SFR trademarks.
  Fine for personal use; it matters if this is ever distributed publicly.
- The rulebooks in `docs/rules/` are SFR's, redistributed under their personal-use grant. They are
  reference material for development, not app content.
- If this ever goes public: no SFR branding, a clear "unofficial fan project" notice, and no
  bundled rulebooks.

## 6. Interface thinking

The real constraint is that an army can be ~15 health of dice, each showing a face, on a 375px
screen, while you pick targets and assign damage. A full tabletop-style board view will not fit.

The working plan:

- **Board strip, not board.** The three terrains as a compact horizontal strip: terrain name,
  current face number, its action icon, and a per-side army-strength badge. Always visible, ~80px tall.
- **Terrain focus view.** Tap a terrain to drill in. This is where the actual playing happens.
  One terrain, two armies, full width.
- **Dice as a wrapping grid** of ~44px tappable tiles (44px is the minimum comfortable touch
  target). Each tile: size indicator + the rolled face glyph. Selected state for targeting.
- **The action bar is driven by `state.pending`.** It states what the game is waiting for in one
  sentence, and offers only the legal choices. The UI never has to decide what is legal.
- **Damage assignment gets a dedicated sheet**: tap units to toggle, with a live
  `absorbed 4 / must reach 5` readout, and the confirm button disabled until the selection is
  maximal. This turns the hardest rule into the most guided screen.
- **Roll results deserve a beat.** Show the dice landing and the arithmetic
  (`7 melee − 3 saves = 4 damage`) before advancing. Players need to trust the app's math, and this
  is also how they learn the rules.
- Landscape and tablet just widen the focus view; no separate layout.

## 7. Milestones

1. **Data** — ~~schema, importers, validator, all 40 unit dice and 12 terrain dice~~ **done.**
2. **Engine core** — state types, `Pending`, seeded RNG, setup, turn sequence, maneuver.
3. **Combat** — melee/missile/magic resolution and damage assignment, with tests first.
4. **PassiveAI** — enough to play a full game against.
5. **UI** — board strip, terrain focus, dice grid, damage sheet, roll results.
6. **Playable alpha** — PWA, persistence, a game start-to-finish.

Then the ruleset flags come off one at a time: SAIs → eighth-face powers → spells → dragons.

## 8. Open questions

Rules-level open questions are in `RULES-V0.md` §8. Project-level:

- Should the alpha ship an **army builder**, or only the two presets? (Currently: presets only.)
- **Magic rounding** — `floor(M / 2)`; `ceil` would make magic notably stronger.
- **Undo**: free to implement given the architecture, but it lets you re-roll bad dice. Offer it
  only as an explicit "rewind" for misclicks, or not at all in the alpha?
- The rulebook PDFs are ~21 MB committed to git. Fine for a personal repo; worth moving to a
  release asset or Git LFS if this ever goes public.
