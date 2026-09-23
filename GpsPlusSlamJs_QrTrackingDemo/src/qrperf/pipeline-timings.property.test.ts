/**
 * Why this test matters: whatever sequence of timings a phone produces, the
 * summary must stay internally consistent (min <= median <= p95 <= max, n
 * bounded by the window), or a screenshot could show impossible numbers that
 * nobody questions. A seeded generator loop keeps it deterministic without a
 * property-testing dependency in this demo package.
 */

import { describe, expect, it } from "vitest";
import { createPipelineTimings } from "./pipeline-timings.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pipeline timings invariants (200 seeded random runs)", () => {
  it("keeps min <= median <= p95 <= max and n <= windowSize", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed);
      const windowSize = 1 + Math.floor(rng() * 50);
      const t = createPipelineTimings({ windowSize });
      const count = 1 + Math.floor(rng() * 120);
      const kept: number[] = [];
      for (let k = 0; k < count; k++) {
        const ms = rng() * 200;
        t.record("detect", ms);
        kept.push(ms);
      }
      const window = kept.slice(-windowSize);
      const s = t.snapshot(0).stages.detect!;
      expect(s.n).toBe(window.length);
      expect(s.median).toBeGreaterThanOrEqual(Math.min(...window));
      expect(s.median).toBeLessThanOrEqual(s.p95);
      expect(s.p95).toBeLessThanOrEqual(s.max);
      expect(s.max).toBe(Math.max(...window));
    }
  });
});
