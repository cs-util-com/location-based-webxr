/**
 * The package's one seeded generator for production code (mulberry32).
 *
 * Production code that needs reproducible randomness (a noise table built
 * from a seed, a precomputed quantile table) draws from this, never from
 * `Math.random` and never from a private copy: one generator in the workspace.
 * Several test files still keep their own copies (listed
 * in the sidecar); production code does not import from `test-utils/`.
 *
 * @see mulberry32.ts.md
 */

/**
 * A generator of uniform draws in [0, 1). The seed is read as an unsigned
 * 32-bit integer (`seed >>> 0`): a fraction is truncated, a negative seed
 * wraps, a non-finite one reads as 0. Callers that must refuse such seeds
 * validate them first.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
