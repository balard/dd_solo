/**
 * `layout.ts` against the real window: the viewport as it is now, the viewer's
 * remembered choice, and the link's.
 */
import { useCallback, useEffect, useState } from 'react'

import { asLayout, canChooseLayout, layoutFor, parseLayout, type Layout, type Viewport } from './layout'
import { readText, writeText } from './prefs'

/**
 * The link's `?layout=`, read once when the app loads.
 *
 * At module load rather than in a hook, because `useGame` clears the query in an effect
 * once a linked game starts (so a refresh does not re-run the link), and a hook mounted
 * after that -- the board, which appears only once there is a game -- would read a bare
 * URL. It holds for the page's life and is never written to the preference: a link
 * says how to show *this* board, not how the viewer likes boards.
 */
const LINKED: Layout | null = typeof window === 'undefined' ? null : parseLayout(window.location.search)

function viewportNow(): Viewport {
  return typeof window === 'undefined'
    ? { width: 1024, height: 768 }
    : { width: window.innerWidth, height: window.innerHeight }
}

/** Rotating a phone fires `resize`, which is when the answer can change. */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState(viewportNow)
  useEffect(() => {
    const update = () => setViewport(viewportNow())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return viewport
}

export interface LayoutChoice {
  readonly layout: Layout
  /** Null where there is no choice to make: a phone held upright. */
  readonly toggle: (() => void) | null
  readonly viewport: Viewport
}

export function useLayout(): LayoutChoice {
  const viewport = useViewport()
  // Reading a preference has no side effect, so the initializer may do it twice.
  const [chosen, setChosen] = useState(() => asLayout(readText('layout')))
  const [linked, setLinked] = useState(LINKED)
  const layout = layoutFor(viewport, chosen, linked)

  const toggle = useCallback(() => {
    const next: Layout = layout === 'cards' ? 'landscape' : 'cards'
    writeText('layout', next)
    setChosen(next)
    // A choice made here outranks the link from then on.
    setLinked(null)
  }, [layout])

  return { layout, toggle: canChooseLayout(viewport) ? toggle : null, viewport }
}
