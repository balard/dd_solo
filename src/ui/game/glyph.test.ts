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
import { DUA_RULES, V0_RULES, type RuleSet } from '../../engine/types'

import { faceLabel } from './Glyph'

const FULL_RULES: RuleSet = { ...DUA_RULES, sai: 'full' }

const sai = (name: string, count = 4): Face => ({ count, icon: 'SAI', sai: name })

describe('faceLabel', () => {
  it('names a normal face by its icon and count', () => {
    expect(faceLabel({ count: 2, icon: 'MELEE' }, DUA_RULES)).toBe('2 melee')
    expect(faceLabel({ count: 4, icon: 'SAVE' }, null)).toBe('4 save')
  })

  it('leaves an SAI the rules resolve unannotated', () => {
    expect(faceLabel(sai('Counter'), DUA_RULES)).toBe('4 Counter')
  })

  /** The rung the app plays: the twelve result SAIs work, the targeting ones do not,
   *  however finished the code behind them is. */
  it('says a targeting SAI does nothing under the rules the app plays', () => {
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

  it('still annotates what no rung resolves yet', () => {
    expect(faceLabel(sai('Cantrip'), FULL_RULES)).toBe('4 Cantrip — does nothing in this game')
    expect(faceLabel(sai('Choke'), FULL_RULES)).toBe('4 Choke — does nothing in this game')
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

  /** Against the data rather than a literal: every SAI face in the box gets a label,
   *  and under the rules the app plays exactly the unbuilt ones are annotated. */
  it('annotates a real Darktree face and not a real Redwood one', () => {
    const smother = unitType('treefolk.darktree').faces[4] as Face
    const trample = unitType('treefolk.redwood').faces[4] as Face

    expect(faceLabel(smother, DUA_RULES)).toBe('4 Smother — does nothing in this game')
    expect(faceLabel(trample, DUA_RULES)).toBe('4 Trample')
  })
})
