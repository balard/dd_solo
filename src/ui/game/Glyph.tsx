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

export type GlyphName = NormalIcon | 'SAI'

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
