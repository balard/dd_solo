import { describe, expect, it } from 'vitest'

import {
  canChooseLayout,
  isPhoneSideways,
  isPhoneUpright,
  layoutFor,
  parseLayout,
  terrainTags,
} from './layout'

/** The frames 3a measured against. */
const LAPTOP = { width: 1366, height: 680 }
const DESKTOP = { width: 1920, height: 960 }
const SIDEWAYS = { width: 844, height: 390 }
const UPRIGHT = { width: 390, height: 844 }

describe('which board', () => {
  it('tells the phones apart from everything else', () => {
    expect(isPhoneSideways(SIDEWAYS)).toBe(true)
    expect(isPhoneUpright(UPRIGHT)).toBe(true)
    for (const screen of [LAPTOP, DESKTOP]) {
      expect(isPhoneSideways(screen)).toBe(false)
      expect(isPhoneUpright(screen)).toBe(false)
    }
  })

  /** 3a finding 1: landscape is the phone's layout, and a matter of taste elsewhere. */
  it('opens a phone held sideways on landscape, and everything else on the cards', () => {
    expect(layoutFor(SIDEWAYS, null, null)).toBe('landscape')
    expect(layoutFor(LAPTOP, null, null)).toBe('cards')
    expect(layoutFor(DESKTOP, null, null)).toBe('cards')
  })

  it("keeps the viewer's choice, and a link's over it", () => {
    expect(layoutFor(LAPTOP, 'landscape', null)).toBe('landscape')
    expect(layoutFor(SIDEWAYS, 'cards', null)).toBe('cards')
    expect(layoutFor(LAPTOP, 'landscape', 'cards')).toBe('cards')
    expect(layoutFor(LAPTOP, null, 'landscape')).toBe('landscape')
  })

  /** Three columns at 390px wide is three columns of nothing. */
  it('keeps an upright phone on the cards whatever was asked, and offers no choice there', () => {
    expect(layoutFor(UPRIGHT, 'landscape', 'landscape')).toBe('cards')
    expect(canChooseLayout(UPRIGHT)).toBe(false)
    for (const screen of [LAPTOP, DESKTOP, SIDEWAYS]) expect(canChooseLayout(screen)).toBe(true)
  })
})

describe('parseLayout', () => {
  it('reads ?layout= beside the game parameters, and nothing else', () => {
    expect(parseLayout('?layout=landscape')).toBe('landscape')
    expect(parseLayout('?forces=bestiary&layout=cards&seed=7')).toBe('cards')
    expect(parseLayout('')).toBeNull()
    expect(parseLayout('?layout=')).toBeNull()
    // A layout cannot change an outcome, so a word nobody knows is simply not a layout.
    expect(parseLayout('?layout=sideways')).toBeNull()
  })
})

describe('terrainTags', () => {
  it('marks a home on its owner’s side, from either seat', () => {
    expect(terrainTags('p1_home', null, 'p1')).toEqual({ mine: 'HOME', theirs: null })
    expect(terrainTags('p2_home', null, 'p1')).toEqual({ mine: null, theirs: 'HOME' })
    expect(terrainTags('p1_home', null, 'p2')).toEqual({ mine: null, theirs: 'HOME' })
    expect(terrainTags('frontier', null, 'p1')).toEqual({ mine: null, theirs: null })
  })

  it('marks a held eighth face on the holder’s side, beside the owner’s HOME', () => {
    expect(terrainTags('frontier', 'p2', 'p1')).toEqual({ mine: null, theirs: 'HELD' })
    expect(terrainTags('p1_home', 'p2', 'p1')).toEqual({ mine: 'HOME', theirs: 'HELD' })
    // Holding your own home is the fact that can win the game, so HELD says it.
    expect(terrainTags('p1_home', 'p1', 'p1')).toEqual({ mine: 'HELD', theirs: null })
  })
})
