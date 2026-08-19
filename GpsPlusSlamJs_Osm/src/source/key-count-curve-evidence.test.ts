/**
 * The key-count curve's shape must still be in the artefact the doc quotes.
 *
 * WHY THIS EXISTS. The 2026-08-19 one-key probe revived the cold-start prefetch
 * by showing that Overpass latency is driven by the number of key statements
 * rather than by area. This sweep put a curve through that with six points, and
 * the curve is what a build/do-not-build decision rests on: eight keys costs
 * ~15 s against the full query's ~22 s, so a "half now, half later" split is not
 * worth building and only a very small first request is.
 *
 * This repo has formally retracted three latency figures that outlived the run
 * that produced them. So the claim the decision rests on is asserted against the
 * committed artefact rather than trusted to a document nobody re-runs.
 *
 * IT NEVER TOUCHES THE NETWORK (DEC-T10): measurement I/O lives in the `.mjs`
 * scripts, this reads a file, and it sits beside the artefact inside a gate that
 * actually runs it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface CurveRow {
  readonly operator: string;
  readonly form: string;
  readonly res: number;
  readonly keyCount?: number;
  readonly status?: string;
  readonly totalMs?: number;
  readonly firstByteMs?: number;
}

const curve = JSON.parse(
  readFileSync(
    resolve(packageRoot, "docs", "overpass-keycount-curve-2026-08-19.json"),
    "utf8",
  ),
) as { readonly complete: boolean; readonly results: readonly CurveRow[] };

/** Rows that actually answered. A 504 carries no latency information. */
const served = curve.results.filter((row) =>
  (row.status ?? "").startsWith("200"),
);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

const totalsAt = (keyCount: number): number[] =>
  served
    .filter((row) => row.keyCount === keyCount)
    .map((row) => row.totalMs)
    .filter((ms): ms is number => Number.isFinite(ms));

const ARMS = [1, 2, 4, 8, 16, 32] as const;

describe("the key-count curve's artefact still supports the decision", () => {
  it("is a COMPLETE run of the query form production sends", () => {
    // Asserted before any number is read from it: an earlier evidence test in
    // this package passed only because the artefact was still being written and
    // its gaps were wider than the threshold.
    expect(curve.complete).toBe(true);
    expect(new Set(served.map((row) => row.form))).toEqual(
      new Set(["areal-only"]),
    );
  });

  it("carries every arm the doc quotes, with enough samples to median", () => {
    // THE GUARD ON THE GUARD. Every assertion below indexes by key count, and a
    // missing arm would make the comparisons silently compare fewer points
    // rather than fail — which is the shape of vacuity this package has already
    // shipped once.
    for (const arm of ARMS) {
      expect(
        totalsAt(arm).length,
        `arm k${arm} has too few successful samples to median`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("rises with the key count from 2 keys upward", () => {
    // The shape the conclusion rests on. The k1/k2 pair is deliberately NOT
    // asserted: their ranges overlap heavily (1.1–30.8 s against 1.5–15.7 s at
    // n=7–8), so they are not separable, and the doc says so rather than
    // reading the inversion as a finding.
    let compared = 0;
    const rising = [2, 4, 8, 16, 32] as const;
    for (let i = 1; i < rising.length; i++) {
      const lower = median(totalsAt(rising[i - 1] as number));
      const higher = median(totalsAt(rising[i] as number));
      compared += 1;
      expect(
        higher,
        `k${rising[i]} answered in ${(higher / 1000).toFixed(1)}s, no slower ` +
          `than k${rising[i - 1]} at ${(lower / 1000).toFixed(1)}s — the curve ` +
          `the build/do-not-build decision rests on has flattened`,
      ).toBeGreaterThan(lower);
    }
    expect(compared).toBe(4);
  });

  it("puts EIGHT keys nearer the full query than to a cheap request", () => {
    // The decision's actual question, asserted directly. DEC-V4 framed it as
    // "8 s or 25 s"; the answer is ~15 s, which is what makes a half-now
    // half-later split not worth building. If a later run moved 8 keys below
    // half the full query's cost, that conclusion would need revisiting — which
    // is exactly when this should fail.
    const eight = median(totalsAt(8));
    const full = median(totalsAt(32));
    expect(eight / full).toBeGreaterThan(0.5);
  });

  it("still leaves a SMALL request meaningfully cheaper than the full one", () => {
    // The other half, and the reason the idea is not dead: four keys is worth
    // asking for where eight is not.
    const four = median(totalsAt(4));
    const full = median(totalsAt(32));
    expect(four / full).toBeLessThan(0.6);
  });

  it("shows the cost arriving BEFORE the body, at every arm", () => {
    // What makes this about query planning rather than download: at res 10 the
    // payloads are 52–325 kB, and time-to-first-byte tracks the total. If that
    // ever stopped holding, the whole "ask for fewer keys" premise would be
    // measuring transfer instead.
    for (const arm of ARMS) {
      const firstByte = served
        .filter((row) => row.keyCount === arm)
        .map((row) => row.firstByteMs)
        .filter((ms): ms is number => Number.isFinite(ms));
      expect(firstByte.length).toBeGreaterThan(0);
      expect(median(firstByte) / median(totalsAt(arm))).toBeGreaterThan(0.9);
    }
  });
});
