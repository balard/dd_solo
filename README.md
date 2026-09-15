# dd_solo

A solo-play app for **Dragon Dice** — you command one side, the app runs the board, the dice and
the opponent.

Unofficial fan project for personal use. Dragon Dice is a registered trademark of SFR, Inc.

**Status:** pre-code. Design docs, a phased implementation plan, and the complete starter-set die
data (40 unit dice, 12 terrain dice).

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
