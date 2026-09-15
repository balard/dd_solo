# dd_solo

A solo-play app for **Dragon Dice** — you command one side, the app runs the board, the dice and
the opponent.

Unofficial fan project for personal use. Dragon Dice is a registered trademark of SFR, Inc.

**Status:** playable. The v0 rules engine and UI are complete; PWA packaging and persistence are
the last step.

```bash
npm install
npm run dev           # play in the browser
npm run play          # or in the terminal
npm test              # 203 tests, including 1000-game self-play
```

On Windows PowerShell, `npm` may be blocked by the script execution policy
(`npm.ps1 cannot be loaded because running scripts is disabled`). Use `.\play.cmd`, or
`npm.cmd` instead of `npm` — the `.cmd` shim is not subject to that policy.

## Where things are

- [`docs/PLAN-V0.md`](docs/PLAN-V0.md) — the nine phases to a playable alpha
- [`docs/OVERVIEW.md`](docs/OVERVIEW.md) — technology, architecture, design rationale
- [`docs/RULES-V0.md`](docs/RULES-V0.md) — the exact rule subset the alpha implements
- [`data/ICONS.md`](data/ICONS.md) — die-face vocabulary
- [`data/starter/`](data/starter/) — generated die data; [`data/raw/`](data/raw/) is the source of truth
- [`CLAUDE.md`](CLAUDE.md) — working notes and invariants

## Target

v1.0 covers the Kickstarter starter set: Treefolk vs Firewalkers. The alpha cuts spells, dragons,
SAIs and eighth-face powers to get to a playable loop — see `docs/RULES-V0.md`.

Web app (PWA) first; the same build wraps into an Android APK via Capacitor.
