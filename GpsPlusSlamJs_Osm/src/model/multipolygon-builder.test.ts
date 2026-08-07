/**
 * Ring-stitching cases that the property tests cannot express.
 *
 * Why these tests matter: `stitchRings` was rewritten for speed on 2026-07-31
 * (endpoint hash map + two-ended chain, replacing a pool rescan + a full chain
 * copy per attach). The rewrite is only worth having if it is
 * output-equivalent, and the property tests run at sizes — 4–14 corners, 1–5
 * pieces — where the two implementations cannot diverge and where the quadratic
 * term is invisible. These pin the two things that the size and shape of the
 * property generators put out of reach:
 *
 * 1. The tie-break. Where several segments could attach, the old linear scan
 *    took the lowest pool index. Anything else is a silent behaviour change on
 *    branching data.
 * 2. The growth curve. A ring split into hundreds of shuffled segments is what
 *    real boundary relations look like, and is the input the rewrite exists
 *    for.
 *
 * @see multipolygon-builder.ts.md
 */

import { describe, it, expect } from "vitest";
import { stitchRings, isClosedRing } from "./multipolygon-builder.js";
import type { LatLng } from "./osm-feature.js";

const at = (lat: number, lng: number): LatLng => ({ lat, lng });

describe("stitchRings — which candidate wins when several fit", () => {
  it("attaches the LOWEST-indexed segment when two could attach at the same end", () => {
    // B and C both start where A ends and both end where A starts, so either
    // would close the ring and only the tie-break decides which. The old pool
    // rescan took the lowest index; the endpoint index must agree, or
    // relations with branching ways stitch differently.
    const a = [at(0, 0), at(0, 1)];
    const b = [at(0, 1), at(1, 1), at(1, 0), at(0, 0)];
    const c = [at(0, 1), at(-1, 1), at(-1, 0), at(0, 0)];

    // Whichever of B/C comes first is consumed into A's ring; the loser is
    // left behind as an unclosed chain. That leftover is the observable.
    const viaB = stitchRings([a, b, c]);
    expect(viaB.ok).toBe(false);
    expect(viaB.ok === false && viaB.unclosed.map((x) => [...x])).toEqual([c]);

    const viaC = stitchRings([a, c, b]);
    expect(viaC.ok).toBe(false);
    expect(viaC.ok === false && viaC.unclosed.map((x) => [...x])).toEqual([b]);
  });

  it("prefers a tail attach over a head attach within the same segment", () => {
    // The seed's two ends both match this segment, which is the case the four
    // ordered checks in `attach` disambiguate. Tail-forward wins.
    const seed = [at(0, 0), at(0, 1)];
    const both = [at(0, 1), at(1, 0), at(0, 0)];

    const result = stitchRings([seed, both]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rings).toHaveLength(1);
    // Tail attach gives 0,0 -> 0,1 -> 1,0 -> 0,0; a head attach would have
    // produced the reverse traversal.
    expect([...result.rings[0]!]).toEqual([
      at(0, 0),
      at(0, 1),
      at(1, 0),
      at(0, 0),
    ]);
  });

  it("absorbs an already-closed segment that shares an endpoint with an open chain", () => {
    // A closed ring sitting in the pool is still a stitch candidate for an
    // open chain — the old rescan saw it, so the endpoint index must too.
    // Pinned because it is pure emergent behaviour, easy to lose in a rewrite.
    const open = [at(0, 0), at(5, 5)];
    const closed = [at(5, 5), at(5, 6), at(6, 6), at(5, 5)];

    const result = stitchRings([open, closed]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The closed ring was consumed into the open chain rather than emitted.
    expect(result.unclosed).toHaveLength(1);
    expect(result.unclosed[0]).toHaveLength(5);
  });
});

describe("stitchRings — NaN endpoints", () => {
  it("never joins two segments that both end in NaN", () => {
    // `positionsEqual` is `===`, so NaN matches nothing — but a hash key built
    // by stringifying would give every NaN endpoint the same key and join
    // them into a fabricated ring. Regression guard for the endpoint index.
    const a = [at(0, 0), at(Number.NaN, Number.NaN)];
    const b = [at(Number.NaN, Number.NaN), at(1, 1)];

    const result = stitchRings([a, b]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Two separate unclosed chains, not one joined chain.
    expect(result.unclosed).toHaveLength(2);
  });
});

/** A closed ring of `n * k` points, handed over as `n` open segments. */
function splitRing(n: number, k: number): LatLng[][] {
  const total = n * k;
  const points: LatLng[] = [];
  for (let i = 0; i < total; i++) {
    const angle = (2 * Math.PI * i) / total;
    points.push(at(50 + 0.01 * Math.cos(angle), 7 + 0.01 * Math.sin(angle)));
  }
  points.push(points[0]!);

  const segments: LatLng[][] = [];
  for (let i = 0; i < n; i++) segments.push(points.slice(i * k, i * k + k + 1));

  // Shuffled: in ring order a linear scan finds its next segment on the first
  // probe, and neither the old cost nor the new saving would show.
  let seed = 20260731;
  const next = (): number =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = segments.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [segments[i], segments[j]] = [segments[j]!, segments[i]!];
  }
  return segments;
}

describe("stitchRings — real relation sizes", () => {
  it("stitches 400 shuffled segments of 64 points into one closed ring", () => {
    // The size the fixtures actually contain: `building-block` holds a
    // 316-member, 26 778-point boundary relation. Correctness at this size was
    // never covered — the property generator stops at 5 pieces.
    const segments = splitRing(400, 64);
    const result = stitchRings(segments);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rings).toHaveLength(1);
    expect(isClosedRing(result.rings[0]!)).toBe(true);
    expect(result.rings[0]).toHaveLength(400 * 64 + 1);
  });

  it("stitches 1600 shuffled segments in well under a second", () => {
    // The hypothesis the 2026-07-31 rewrite exists for: stitching is no longer
    // quadratic in the chain's point count.
    //
    // AN ABSOLUTE BUDGET, NOT A RATIO. The first attempt compared 200 against
    // 800 segments and expected ~4x; it failed at 17x, because at 200 segments
    // the work is a few hundred microseconds and the measurement is mostly
    // noise. Dividing two noisy sub-millisecond numbers measures the noise.
    //
    // The budget is sized off the gap, which is enormous rather than marginal
    // (devbox-win11, 1600 segments x 64 points): the previous implementation
    // took 1063 ms, this one 5.5 ms. 500 ms leaves ~90x headroom over the new
    // cost while still failing decisively if the quadratic term returns — the
    // old code could not meet it even on hardware twice this fast.
    const segments = splitRing(1600, 64);
    stitchRings(segments); // warm-up, so JIT is not in the measurement

    const started = performance.now();
    const result = stitchRings(segments);
    const elapsed = performance.now() - started;

    expect(result.ok).toBe(true);
    expect(result.ok && result.rings).toHaveLength(1);
    expect(elapsed).toBeLessThan(500);
  });
});
