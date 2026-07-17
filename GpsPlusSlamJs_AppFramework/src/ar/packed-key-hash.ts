/**
 * Open-addressed hash map for packed cell keys — the mesher hot-loop
 * replacement for `Map<number, number>` / `Set<number>`.
 *
 * WHY (2026-07-17 perf loop, iteration 2): profiling the production-default
 * 'smooth' surface-nets mesher showed ~65% of its time inside Map/Set
 * operations keyed by packed cell keys (occupied-membership tests, dual-vertex
 * welding, centroid memo). This flat typed-array table answers the same
 * lookups without per-entry heap boxes or hash-object overhead — together
 * with the smooth builder's ordinal/incremental-key rewrite it took the
 * production re-mesh (`runMeshRequest`, 100k-cell corpus regime) from 331 to
 * 101 ms, −69% (byte-identical output, see occupancy-mesher.ts.md).
 *
 * CONTRACT (deliberately narrow — this is a fast path, not a general map):
 * - Keys: non-negative finite numbers ≤ 2^53 (packed cell keys are ≤ ~2^51).
 *   `-1` is the internal empty sentinel, so negative keys are unsupported.
 * - Values: integers ≥ 0 (Int32). `get` returns `-1` for absent keys — the
 *   caller-friendly miss signal that avoids an `undefined` check in hot loops.
 *   Storing a negative value throws (it would read back as a miss).
 * - No delete (the mesher builds tables once per mesh and drops them).
 *
 * Implementation: linear probing over power-of-two capacity, grown at ~2/3
 * load by rehashing (growth is CORRECTNESS, not tuning — a full table would
 * probe forever). The 51-bit key is mixed to 32 bits via lo³²⊕hi²¹ and a
 * golden-ratio `Math.imul` spread; packed keys are highly structured
 * (base-2^17 positional), and the multiplicative mix breaks that structure —
 * verified by the property test driving adjacent-coordinate workloads.
 *
 * @see packed-key-hash.ts.md for detailed documentation
 */

const EMPTY = -1;
const TWO_32 = 4_294_967_296;

export class PackedKeyHash {
  private keys: Float64Array;
  private vals: Int32Array;
  private mask: number;
  private used = 0;
  /** Grow when `used` exceeds this (2/3 of capacity). */
  private growAt: number;

  /**
   * @param expectedEntries sizing hint — the table starts at the next power
   *   of two ≥ 2× the hint (≥ 16) and grows transparently beyond it.
   */
  constructor(expectedEntries: number) {
    let cap = 16;
    const target = Math.max(0, expectedEntries) * 2;
    while (cap < target) {
      cap *= 2;
    }
    this.keys = new Float64Array(cap).fill(EMPTY);
    this.vals = new Int32Array(cap);
    this.mask = cap - 1;
    this.growAt = (cap * 2) / 3;
  }

  /** Number of distinct keys stored. */
  get size(): number {
    return this.used;
  }

  /** The slot holding `key`, or the empty slot where it would be inserted. */
  private slot(key: number): number {
    const hi = Math.floor(key / TWO_32);
    const lo = key - hi * TWO_32;
    // Full-avalanche mix (murmur3 fmix32 over lo ⊕ spread(hi)). A single
    // multiplicative mix is NOT enough here: packed keys along one axis
    // differ by 2^17 or 2^34, so `imul(lo ^ hi, C)` leaves the index's low
    // bits CONSTANT for e.g. a y-varying wall (product low bits stay zero)
    // — every key lands in one probe chain and lookups degenerate to O(n).
    // Caught by the growth unit test (stride-2^17 keys) timing out in CI.
    let h = lo ^ Math.imul(hi, 0x9e3779b1);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    let i = (h >>> 0) & this.mask;
    const keys = this.keys;
    while (keys[i] !== EMPTY && keys[i] !== key) {
      i = (i + 1) & this.mask;
    }
    return i;
  }

  /** Value stored for `key`, or -1 when absent. */
  get(key: number): number {
    const i = this.slot(key);
    return this.keys[i] === key ? this.vals[i]! : -1;
  }

  /** True iff `key` is stored. */
  has(key: number): boolean {
    return this.keys[this.slot(key)] === key;
  }

  /** Insert or overwrite. `value` must be an integer ≥ 0 (see contract). */
  set(key: number, value: number): void {
    if (value < 0) {
      throw new RangeError(
        `PackedKeyHash values must be ≥ 0 (got ${value}); -1 is the miss sentinel`
      );
    }
    const i = this.slot(key);
    if (this.keys[i] === EMPTY) {
      if (this.used >= this.growAt) {
        this.grow();
        // Re-probe in the grown table (slots move on rehash).
        this.setPresized(key, value);
        return;
      }
      this.used++;
    }
    this.keys[i] = key;
    this.vals[i] = value;
  }

  /** `set` after `grow()` — capacity is guaranteed, no growth check needed. */
  private setPresized(key: number, value: number): void {
    const i = this.slot(key);
    if (this.keys[i] === EMPTY) {
      this.used++;
    }
    this.keys[i] = key;
    this.vals[i] = value;
  }

  private grow(): void {
    const oldKeys = this.keys;
    const oldVals = this.vals;
    const cap = (this.mask + 1) * 2;
    this.keys = new Float64Array(cap).fill(EMPTY);
    this.vals = new Int32Array(cap);
    this.mask = cap - 1;
    this.growAt = (cap * 2) / 3;
    this.used = 0;
    for (let i = 0; i < oldKeys.length; i++) {
      const k = oldKeys[i]!;
      if (k !== EMPTY) {
        this.setPresized(k, oldVals[i]!);
      }
    }
  }
}
