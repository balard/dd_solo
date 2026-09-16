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
and the *defender* chooses which. **Do not enumerate the maximal subsets**: there can be
exponentially many and the list is not something a UI can render. `maxAbsorbable` is a subset-sum
DP over achievable totals ≤ damage, O(n · damage); the damage sheet lets the player toggle units
against `absorbed N / must reach M`, and the reducer rejects anything `isMaximalSubset` refuses.
Better interface and the cheaper algorithm, which is not the usual trade.

This is the rule most likely to be implemented wrong by reflex, so it gets tests first. Greedy is
the specific reflex: largest-first passes most cases but takes the 3 against 4 damage and units of
3, 2, 2, stranding a point where `{2,2}` absorbs all four.

### Scope lives in a ruleset config, not in `if` statements

```ts
interface RuleSet {
  magic: 'simplified' | 'spells'                  // now 'simplified' — RULES-V0.md §4
  sai: 'inert' | 'full'                           // now 'inert' — SAI faces roll as zero results
  eighthFace: 'captureOnly' | 'standard' | 'full' // now 'standard' — the two advantages, no icons
  dragons: boolean                                // now false
}
```

v1 adds a `'results'` tier to `sai` (Phase 1) and a `speciesAbilities` flag (Phase 8); see
`PLAN-V1.md` §10 for the target values.

The v0 → v1 ladder then has a concrete shape: each flag advanced is a milestone, and the cut
features have a named home before anyone writes them. It also keeps the alpha's house rules from
being quietly welded into the engine.

**A flag gains a tier; it never loses a branch.** `eighthFace` went `'captureOnly' → 'standard'`
by adding a rung rather than deleting a condition, and `sai` gains `'results'` the same way in v1
Phase 1. `V0_RULES` therefore stays playable for the life of the project, which is what makes it
usable as the regression baseline for every v1 phase.

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
| Terrains (v0) | **complete** — 3 types × 4 eighth-face variants = 12 dice |
| Terrains (v1) | **missing** — Coastland, Flatland, Feyland: 3 types × 4 variants = 12 dice |
| Dragons (v1) | **missing** — 5 elements × 2 forms (drake/wyrm) = 10 dice, 12 faces each |

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

**The two v1 gaps are the same lesson, not yet learned twice.** Nothing about the three known
terrain types predicts where Coastland's magic/missile split falls, so the three new types must be
transcribed like the first three. Dragons are worse: the rulebook documents what each icon *does*
(Jaws 12 damage, Claws 6, Wing 5 and fly home, Tail 3 and roll again, Breath, Treasure, Belly) but
never how many of each appear on the twelve faces. The one structural hint is that dragons "come in
two forms: drakes, which have wings, and wyrms, which have a treasure chest" — which looks like the
same base-plus-variant shape as a terrain die, and which is therefore exactly the kind of plausible
inference that the terrain split points already proved unsafe. Treat it as a hypothesis to check
against real dice. These block v1 Phases 5 and 6 and are the long pole in that plan.

### Reference art

`tools/fetch_faces.py` mirrors the real SVGs for every face our data references into
`public/faces/` (gitignored) — that is the only directory Vite serves, so art anywhere else is
invisible to the browser. `--offline` re-mirrors from a local copy (`assets/faces/` by default,
or `--source=DIR`) instead of the network. The remote asset set is **sparse, per-species, and not derivable from (icon, count)**. It mirrors
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

- **v0 — `PassiveAI`.** Never takes a march, never declares a maneuver, never attacks. But it is
  *not* a no-op: it must still answer every mandatory pending decision — save rolls, damage
  assignment (maximally, per the rules), counter-attacks, and contesting a maneuver declared
  against it. This is exactly enough to test the whole loop, and it proves the `Pending`
  abstraction works before any strategy exists. Contesting and countering are both free, so
  declining them would cost it the terrain track for nothing and leave those paths untested.
- **v1 — `GreedyAI`.** Heuristic scoring over enumerated legal actions: expected damage, terrain
  progress, army health preserved.
- **v2 — search.** Genuinely tractable here, unlike most games: every die's face distribution is
  fully known and tiny, so the expected results of any roll are computable in closed form rather
  than sampled. An expectimax over one or two plies is realistic.

Keep `AiPlayer` as an interface from day one so all three are drop-in.

## 5. Legal and asset position

This is a fan-made solo aid for a game we own. Worth being deliberate about:

- **The repository contains no SFR artwork**, and must not. `tools/fetch_faces.py` (`npm run art`)
  mirrors it into `public/faces/`, which is gitignored.
- **The app must be complete without it.** Every face falls back to our own glyphs when the
  manifest is absent, so a fresh clone that never runs the fetcher is a whole game rather than a
  broken one. That is not a nicety: it is what keeps the project distributable.
- **A local build does show the real dice**, because Vite serves `public/`. That is a personal-use
  decision. **Consequence worth stating plainly: `npm run build` copies `public/faces/` into
  `dist/`, so publishing that `dist/` would be redistributing SFR's art.** Delete `public/faces/`
  before building anything you intend to share.
- **Size decides which art is right, not quality.** Measured: at 16–17px the real faces fail — a
  multi-icon face packs its copies into ~7px each and an ID portrait becomes a smudge. At 30px and
  above they are clearly better than our glyphs, and they draw their own count, so they need no
  badge. Hence art in the die inspector (44px), the roll strip (30px) and terrain chips (28px);
  glyphs everywhere smaller and as the universal fallback.
- Do not hotlink the art at runtime — it breaks offline use and depends on paths they are free to
  change.
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

Expanded into phases with exit criteria and tests in [`PLAN-V0.md`](PLAN-V0.md). Summary:

1. ~~**Data** — schema, importers, validator, all 40 unit dice and 12 terrain dice~~ **done.**
2. ~~**Engine core** — state types, `Pending`, seeded RNG, setup, turn sequence, maneuver~~ **done.**
3. ~~**Combat** — melee/missile/magic resolution and damage assignment, with tests first~~ **done.**
4. ~~**PassiveAI** — enough to play a full game against~~ **done.**
5. ~~**UI** — board of terrain cards, dice grid, damage sheet, roll results~~ **done.**
6. ~~**Playable alpha** — PWA, persistence, a game start-to-finish~~ **done.**

### v1 — the complete basic game for these two species

Ten phases in [`PLAN-V1.md`](PLAN-V1.md): every SAI, all six basic terrain types and all four
eighth-face icons, promotion and resurrection, the five elemental dragons, and all 18 spells
Treefolk and Firewalkers can cast.

The order is **not** the order the features were cut in, which is the one thing worth carrying
across from that document. v0 computes a roll as a sum; the rulebook computes it as a ten-step
pipeline (*Die Roll Resolution*, full rules p. 27), and every v1 feature attaches to a numbered step
of it. So v1 opens with one behaviour-preserving refactor and then fills in a structure that already
exists:

```
0 roll pipeline -> 1 SAIs (results) -> 2 DUA/BUA/promotion -> 3 effects & durations
  -> 4 SAIs (targeting) -> 5 terrains & eighth faces -> 6 dragons -> 7 spells
  -> 8 species abilities -> 9 UI & AI
```

Phases 1–3 are independent of each other. Tower can be pulled forward to sit right after Phase 0.
Two phases are blocked on die data that is in neither rulebook — see §3, *Where the data comes
from*.

## 8. Open questions

Rules-level open questions are in `RULES-V0.md` §9. Project-level:

- Should we ship an **army builder**, or only the two presets? (Currently: presets only.) Held back
  from `PLAN-V1.md` on purpose: a builder is what makes *more species* worth having, so it belongs
  with them rather than with the rules. That makes it the obvious first move once v1 lands.
- **Undo**: free to implement given the architecture, but it lets you re-roll bad dice. Offer it
  only as an explicit "rewind" for misclicks, or not at all?
- **Where the UI investment goes.** v1 is a rules ladder and buys almost no visual change — the
  board, the dice and the log look the same with dragons on them. Rolling animation, colour and
  motion are a separate track that can be taken in slices at any point, and are worth most right
  after Phase 1, when a fifth of the faces stop being blanks.
- **`PassiveAI` has an expiry date.** It is an honest opponent in v0 because it has nothing to
  decline but attacks. Once it is declining 18 spells and every SAI target, "passive" quietly
  becomes "handicapped" and solo play stops testing the rules. `PLAN-V1.md` Phase 9 is where
  `GreedyAI` (§4) lands; the open question is whether the end of the ladder is early enough.
- The rulebook PDFs are ~21 MB committed to git. Fine for a personal repo; worth moving to a
  release asset or Git LFS if this ever goes public.
