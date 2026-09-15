/**
 * Deterministic randomness.
 *
 * The generator is a pure function of `{ seed, counter }`, both of which live in
 * `GameState`. There is no hidden internal state, so serialising a game means
 * serialising two integers, and replaying an action log reproduces every die.
 *
 * Never call `Math.random` in the engine -- `purity.test.ts` enforces this.
 */

/** The complete random state. Serialisable, comparable, and part of `GameState`. */
export interface RngState {
  readonly seed: number
  readonly counter: number
}

export function rngFrom(seed: number): RngState {
  return { seed: seed >>> 0, counter: 0 }
}

const TWO_32 = 0x1_0000_0000

/**
 * Mixes (seed, counter) into a well-distributed uint32.
 *
 * This is a counter-based hash rather than a stateful stream, which is what lets
 * the RNG be a plain value: any (seed, counter) pair can be evaluated directly,
 * with no need to have generated everything before it.
 */
function hash32(seed: number, counter: number): number {
  let x = (seed ^ Math.imul(counter + 1, 0x9e37_79b9)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x21f0_aaad) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x735a_2d97) >>> 0
  return (x ^ (x >>> 15)) >>> 0
}

/**
 * A uniform integer in `[0, bound)`, plus the advanced state.
 *
 * Uses rejection sampling rather than a plain modulo. Plain modulo would skew
 * slightly toward low faces, which is exactly the kind of quiet unfairness nobody
 * would ever notice and everybody would eventually suspect.
 */
export function nextInt(rng: RngState, bound: number): readonly [number, RngState] {
  if (!Number.isInteger(bound) || bound < 1) {
    throw new RangeError(`bound must be a positive integer, got ${bound}`)
  }

  // Largest multiple of `bound` that fits in a uint32; values at or above it
  // would over-represent the low residues, so they are redrawn.
  const limit = Math.floor(TWO_32 / bound) * bound

  let state = rng
  for (;;) {
    const value = hash32(state.seed, state.counter)
    state = { seed: state.seed, counter: state.counter + 1 }
    if (value < limit) {
      return [value % bound, state] as const
    }
  }
}

/** Rolls one die, returning a zero-based face index. */
export function rollDie(rng: RngState, faceCount: number): readonly [number, RngState] {
  return nextInt(rng, faceCount)
}

/**
 * Rolls several dice, threading the RNG through them.
 *
 * `faceCounts` is per-die because a starter army mixes d6 units and d10 monsters.
 */
export function rollDice(
  rng: RngState,
  faceCounts: readonly number[],
): readonly [readonly number[], RngState] {
  const indices: number[] = []
  let state = rng
  for (const faceCount of faceCounts) {
    const [index, next] = rollDie(state, faceCount)
    indices.push(index)
    state = next
  }
  return [indices, state] as const
}
