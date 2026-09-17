/**
 * What a face says on hover.
 *
 * Tested in node, like `prompts.ts` and `newGame.ts`, because the rule is a pure
 * function and the failure it exists to prevent is a *sentence* being wrong rather
 * than a component being broken. It has been wrong twice: "(inert in v0)" outlived v0,
 * and asking `LIVE_SAIS` called every targeting SAI unimplemented the moment the app
 * was due to start playing them.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import type { Face } from '../../data/types'
import { DUA_RULES, FULL_RULES, V0_RULES } from '../../engine/types'

import { faceLabel } from './Glyph'

const sai = (name: string, count = 4): Face => ({ count, icon: 'SAI', sai: name })

describe('faceLabel', () => {
  it('names a normal face by its icon and count', () => {
    expect(faceLabel({ count: 2, icon: 'MELEE' }, DUA_RULES)).toBe('2 melee')
    expect(faceLabel({ count: 4, icon: 'SAVE' }, null)).toBe('4 save')
  })

  it('leaves an SAI the rules resolve unannotated', () => {
    expect(faceLabel(sai('Counter'), DUA_RULES)).toBe('4 Counter')
  })

  /** `DUA_RULES` is no longer what the app plays, but it is still a rung the engine
   *  has, and on it the targeting SAIs are inert. */
  it('says a targeting SAI does nothing on the results rung', () => {
    expect(faceLabel(sai('Smother'), DUA_RULES)).toBe('4 Smother — does nothing in this game')
    expect(faceLabel(sai('Flame', 2), DUA_RULES)).toBe('2 Flame — does nothing in this game')
  })

  /**
   * The bug this replaced. Under `sai: 'full'` those same faces resolve, and a label
   * keyed on `LIVE_SAIS` -- the `'results'` table -- called all eight of them
   * unimplemented anyway. Phase 4e flips the app to this rung.
   */
  it('stops saying it once the rules being played do resolve it', () => {
    for (const name of ['Smother', 'Flame', 'Seize', 'Bullseye', 'Sleep']) {
      expect(faceLabel(sai(name), FULL_RULES), name).toBe(`4 ${name}`)
    }
  })

  /**
   * Phase 4e finished the set, so under the rules the app now plays there is nothing
   * left to annotate -- including the two that used to throw "needs spells". A name
   * no rung claims still says so, which is what the annotation is for from here on:
   * a new species' SAI arriving before its handler does.
   */
  it('annotates nothing the finished rung resolves, and still catches a stranger', () => {
    for (const name of ['Cantrip', 'Dispel Magic', 'Choke', 'Confuse', 'Wild Growth']) {
      expect(faceLabel(sai(name), FULL_RULES), name).toBe(`4 ${name}`)
    }
    expect(faceLabel(sai('Backflip'), FULL_RULES)).toBe('4 Backflip — does nothing in this game')
  })

  it('annotates every SAI under V0_RULES, where none of them do anything', () => {
    for (const name of ['Counter', 'Smite', 'Smother']) {
      expect(faceLabel(sai(name), V0_RULES), name).toContain('does nothing')
    }
  })

  /** No provider, no claim. A label with no rules to judge by guessing either way is
   *  how this went wrong the first two times. */
  it('claims nothing when nobody said which rules these are', () => {
    expect(faceLabel(sai('Smother'), null)).toBe('4 Smother')
    expect(faceLabel(sai('Counter'), null)).toBe('4 Counter')
  })

  /** Against the data rather than a literal, on both rungs the engine has. */
  it('annotates a real Darktree face and not a real Redwood one', () => {
    const smother = unitType('treefolk.darktree').faces[4] as Face
    const trample = unitType('treefolk.redwood').faces[4] as Face

    expect(faceLabel(smother, DUA_RULES)).toBe('4 Smother — does nothing in this game')
    expect(faceLabel(trample, DUA_RULES)).toBe('4 Trample')
    // And under what the app plays, both are simply what they are.
    expect(faceLabel(smother, FULL_RULES)).toBe('4 Smother')
  })
})
