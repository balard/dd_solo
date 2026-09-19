/**
 * Our own result-type glyphs.
 *
 * Deliberately not SFR's icon art (see OVERVIEW.md section 5) -- and in any case the
 * real art is not legible at 24px, which is the size that matters on a phone.
 *
 * Everything is stroked in `currentColor` on a 24x24 grid, so colour and theming
 * come from CSS and a glyph never needs a light and dark variant.
 */
import type { Face, NormalIcon } from '../../data/types'
import { resolvesSai } from '../../engine/sai'
import type { RuleSet } from '../../engine/types'

import { useRuleSet } from './useRuleSet'

/**
 * The seven dragon icons are faces too, just not of a unit die -- and `JAWS`
 * doubles as the mark for a dragon standing at a terrain, the way an ID face is a
 * unit's portrait.
 */
export type DragonGlyphName =
  | 'JAWS'
  | 'BREATH'
  | 'CLAW'
  | 'BELLY'
  | 'WING'
  | 'TAIL'
  | 'TREASURE'

export type GlyphName = NormalIcon | 'SAI' | DragonGlyphName

const PATHS: Record<GlyphName, JSX.Element> = {
  // A ring around a dot: this die, being itself.
  ID: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  // A blade with a crossguard.
  MELEE: (
    <>
      <path d="M12 3.5 L12 16" />
      <path d="M8 8.5 L16 8.5" />
      <path d="M9.5 16 L14.5 16 L12 20.5 Z" />
    </>
  ),
  // An arrow in flight.
  MISSILE: (
    <>
      <path d="M4.5 19.5 L19 5" />
      <path d="M13 5 L19 5 L19 11" />
      <path d="M4.5 19.5 L9 18 L6 15 Z" />
    </>
  ),
  // A six-point burst.
  MAGIC: (
    <>
      <path d="M12 2.5 L12 21.5" />
      <path d="M4 7 L20 17" />
      <path d="M20 7 L4 17" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  // A shield.
  SAVE: <path d="M12 3 L19.5 6 V12 C19.5 16.5 16 19.8 12 21 C8 19.8 4.5 16.5 4.5 12 V6 Z" />,
  // Chevrons: moving the terrain.
  MANEUVER: (
    <>
      <path d="M5 14.5 L12 7.5 L19 14.5" />
      <path d="M5 19 L12 12 L19 19" />
    </>
  ),
  // A star, for "something special happens".
  SAI: (
    <>
      <path d="M12 3 L14.4 9.3 L21 9.8 L16 14.1 L17.6 20.5 L12 17 L6.4 20.5 L8 14.1 L3 9.8 L9.6 9.3 Z" />
    </>
  ),
  // Open jaws seen side-on, with two fangs. The dragon's heaviest face (12
  // damage), and so the one that stands for a dragon on the board.
  JAWS: (
    <>
      <path d="M3 7.5 C7 5 14 5 20.5 8.5" />
      <path d="M3 16.5 C7 19 14 19 20.5 15.5" />
      <path d="M7 6.6 L8.6 10" />
      <path d="M12 6.2 L13.6 9.6" />
      <path d="M7 17.4 L8.6 14" />
      <path d="M12 17.8 L13.6 14.4" />
    </>
  ),
  // A plume, widening as it leaves the mouth.
  BREATH: (
    <>
      <path d="M3.5 12 C7 9.5 9 9.5 12 11" />
      <path d="M3.5 12 C7 14.5 9 14.5 12 13" />
      <path d="M14 7.5 C18 9 20 10.5 21 12 C20 13.5 18 15 14 16.5" />
    </>
  ),
  // Three raking claw marks.
  CLAW: (
    <>
      <path d="M6 4 C8.5 8.5 9.5 14 9 20" />
      <path d="M11.5 3.5 C14 8 15 13.5 14.5 19.5" />
      <path d="M17 4.5 C19 8.5 19.8 13 19.4 18" />
    </>
  ),
  // A soft underside, exposed: the belly the automatic saves stop covering.
  BELLY: (
    <>
      <path d="M4 6.5 C4 14 7.5 19.5 12 19.5 C16.5 19.5 20 14 20 6.5" />
      <path d="M8 10.5 C9.5 12.5 14.5 12.5 16 10.5" />
    </>
  ),
  // A single spread wing, with two spars.
  WING: (
    <>
      <path d="M3.5 6 C10 6.5 17 10 21 17 C15.5 17.5 9 15 4.5 10.5 Z" />
      <path d="M7 7.5 L10.5 15.5" />
      <path d="M12 9.5 L14.5 16.6" />
    </>
  ),
  // A tapering tail with a spade tip.
  TAIL: (
    <>
      <path d="M3.5 19.5 C9 18.5 13.5 15 15.5 10" />
      <path d="M15.5 10 L19.5 4.5 L20.5 11 Z" />
    </>
  ),
  // A chest with a lid and a clasp.
  TREASURE: (
    <>
      <path d="M3.5 10.5 H20.5 V19 H3.5 Z" />
      <path d="M3.5 10.5 C4.5 6.5 7.5 5 12 5 C16.5 5 19.5 6.5 20.5 10.5" />
      <path d="M12 9.5 V15" />
    </>
  ),
}

export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      className={`glyph glyph-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

/** A rolled face: its glyph plus how many icons it carries. */
export function FaceGlyph({ face, size = 20 }: { face: Face; size?: number }) {
  const ruleSet = useRuleSet()
  return (
    <span className={`face-glyph i-${face.icon}`} title={faceLabel(face, ruleSet)}>
      <Glyph name={face.icon} size={size} />
      {face.count > 1 && <span className="face-count">{face.count}</span>}
    </span>
  )
}

/**
 * What a face says on hover.
 *
 * **An SAI is annotated when the rules being played cannot resolve it** -- which is a
 * question about the game on screen, not about the build, and it took two wrong
 * answers to land on that. It read "(inert in v0)", which stopped being true when
 * twelve SAIs started generating results; then it asked `LIVE_SAIS`, the `'results'`
 * table, which is right only while the app plays that rung and calls all eight
 * targeting SAIs unimplemented the moment it does not. The ruleset is the only thing
 * that knows, so `resolvesSai` is asked and `useRuleSet` is how it gets here without a
 * prop on every die tile.
 *
 * `null` means nobody said which rules these are, and then it claims nothing at all:
 * silence is the one failure mode that cannot be wrong.
 */
export function faceLabel(face: Face, ruleSet: RuleSet | null): string {
  if (face.icon !== 'SAI') return `${face.count} ${face.icon.toLowerCase()}`

  const named = `${face.count} ${face.sai}`
  if (ruleSet === null || resolvesSai(face.sai, ruleSet)) return named

  // "Does nothing" is the truth on every rung the app can play. On `sai: 'full'` an
  // unbuilt SAI is refused rather than idle -- but a game that could roll one cannot
  // be started, and Phase 4e empties that set.
  return `${named} — does nothing in this game`
}
