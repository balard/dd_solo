import { describe, expect, it } from 'vitest'

import { nextInt, rngFrom, rollDice, rollDie } from './rng'

describe('rng', () => {
  it('is a pure function of (seed, counter)', () => {
    const a = nextInt({ seed: 42, counter: 7 }, 6)
    const b = nextInt({ seed: 42, counter: 7 }, 6)
    expect(a[0]).toBe(b[0])
    expect(a[1]).toEqual(b[1])
  })

  it('never mutates the state it is given', () => {
    const state = rngFrom(1)
    nextInt(state, 6)
    expect(state).toEqual({ seed: 1, counter: 0 })
  })

  it('advances the counter and keeps the seed', () => {
    const [, next] = nextInt(rngFrom(99), 6)
    expect(next.seed).toBe(99)
    expect(next.counter).toBeGreaterThan(0)
  })

  it('stays within bounds', () => {
    let state = rngFrom(12345)
    for (let i = 0; i < 2000; i++) {
      const [value, next] = nextInt(state, 6)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(6)
      state = next
    }
  })

  it('rejects a non-positive bound', () => {
    expect(() => nextInt(rngFrom(1), 0)).toThrow(RangeError)
    expect(() => nextInt(rngFrom(1), -3)).toThrow(RangeError)
    expect(() => nextInt(rngFrom(1), 2.5)).toThrow(RangeError)
  })

  it('gives different seeds different streams', () => {
    const streamOf = (seed: number) => {
      let state = rngFrom(seed)
      return Array.from({ length: 20 }, () => {
        const [value, next] = nextInt(state, 6)
        state = next
        return value
      })
    }
    expect(streamOf(1)).not.toEqual(streamOf(2))
  })

  // The reason for rejection sampling rather than a plain modulo. A skew here would
  // be invisible in play and impossible to argue about later.
  it.each([6, 10])('is close to uniform over %i faces', (faces) => {
    const rolls = 60_000
    const counts = new Array<number>(faces).fill(0)
    let state = rngFrom(2024)

    for (let i = 0; i < rolls; i++) {
      const [value, next] = rollDie(state, faces)
      counts[value] = (counts[value] ?? 0) + 1
      state = next
    }

    const expected = rolls / faces
    // Chi-square with 5 or 9 degrees of freedom; well under the 0.001 critical
    // value (20.5 / 27.9) for a fair generator, and huge for a broken one.
    const chiSquare = counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0)
    expect(chiSquare).toBeLessThan(faces === 6 ? 20.5 : 27.9)
  })

  it('threads state through a mixed handful of dice', () => {
    const [indices, next] = rollDice(rngFrom(7), [6, 6, 10, 6, 10])
    expect(indices).toHaveLength(5)
    expect(indices[2]).toBeLessThan(10)
    expect(indices[0]).toBeLessThan(6)
    expect(next.counter).toBeGreaterThanOrEqual(5)
  })

  it('rolls no dice for an empty army without advancing the rng', () => {
    const start = rngFrom(3)
    const [indices, next] = rollDice(start, [])
    expect(indices).toEqual([])
    expect(next).toEqual(start)
  })
})
