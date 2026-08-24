/**
 * The one-key probe's finding must still be in the artefact it is quoted from.
 *
 * WHY THIS TEST EXISTS. On 2026-08-19 a measurement concluded that the ~22 s
 * Overpass floor is not about area, and a decision doc turned that into "the
 * cold-start micro-fetch is dead". Eight hours later this probe found the floor
 * IS about the query — one key returns in 2.5 s where 32 take 28.2 s — and
 * revived the idea. Both conclusions came from committed runs, and the second
 * one only overturns the first because the run is on disk and can be re-read.
 *
 * This repo's recorded failure mode is exactly that link rotting: three latency
 * figures have had to be formally retracted because a number outlived the run
 * that produced it and went on being quoted as current. So the numbers in
 * `2026-08-19-0800-overpass-one-key-probe-results.md` are asserted here against
 * the artefact rather than trusted to a doc nobody re-runs.
 *
 * IT NEVER TOUCHES THE NETWORK. Measurement I/O lives in the `.mjs` scripts
 * (DEC-T10); this reads a file. It lives beside the artefact and inside a gate
 * that actually runs it, which is the placement that decision settled on after
 * its first draft put the analysis somewhere neither was true.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

interface ProbeRow {
  readonly operator: string;
  readonly form: string;
  readonly res: number;
  readonly keyCount?: number;
  readonly status?: string;
  readonly totalMs?: number;
  readonly firstByteMs?: number;
  readonly bytes?: number;
}

const probe = JSON.parse(
  readFileSync(
    resolve(packageRoot, "docs", "overpass-onekey-probe-2026-08-19.json"),
    "utf8",
  ),
) as { readonly complete: boolean; readonly results: readonly ProbeRow[] };

/** Rows that actually answered. A 504 carries no latency information. */
const served = probe.results.filter((row) =>
  (row.status ?? "").startsWith("200"),
);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

const armOf = (keyCount: number): readonly ProbeRow[] =>
  served.filter((row) => row.keyCount === keyCount);

const totalsOf = (keyCount: number): number[] =>
  armOf(keyCount)
    .map((row) => row.totalMs)
    .filter((ms): ms is number => Number.isFinite(ms));

describe("the one-key probe's artefact still says what the doc quotes", () => {
  it("is a COMPLETE run of the query form production sends", () => {
    // A partial run is the specific trap this repo has already fallen into: an
    // earlier evidence test passed only because the artefact was still being
    // written and its gaps were wider than the threshold. Completeness is
    // asserted first, before any number is read from it.
    expect(probe.complete).toBe(true);
    expect(new Set(served.map((row) => row.form))).toEqual(
      new Set(["areal-only"]),
    );
  });

  it("records the key count PER ROW, which is the whole comparison", () => {
    // Without this field the artefact cannot distinguish its two arms, and
    // every assertion below would be unfalsifiable — the exact shape of the
    // vacuous evidence test this package shipped once already.
    expect(served.length).toBeGreaterThan(0);
    for (const row of served) {
      expect(typeof row.keyCount).toBe("number");
    }
    expect(new Set(served.map((row) => row.keyCount))).toEqual(
      new Set([1, 32]),
    );
  });

  it("has enough successful samples in BOTH arms to compare them", () => {
    // The guard on the guard. An artefact where one arm failed entirely would
    // make the separation test below pass trivially or throw, and neither reads
    // as "this evidence is gone".
    expect(totalsOf(1).length).toBeGreaterThanOrEqual(5);
    expect(totalsOf(32).length).toBeGreaterThanOrEqual(5);
  });

  it("shows one key answering at least 5x faster than thirty-two", () => {
    // The doc quotes 2.5 s against 28.2 s — 11.3x. The threshold is set well
    // below that on purpose: this test guards the FINDING, not the sample. A
    // later run that shrank the gap to 6x would still support "the floor is the
    // query", and should not fail; one that shrank it to 1.5x would falsify the
    // conclusion the plan acted on, and must.
    const oneKey = median(totalsOf(1));
    const fullQuery = median(totalsOf(32));

    expect(
      fullQuery / oneKey,
      `one key answered in ${(oneKey / 1000).toFixed(1)}s and 32 keys in ` +
        `${(fullQuery / 1000).toFixed(1)}s — the doc's claim that the latency ` +
        `floor is the QUERY rather than the area rests on this ratio`,
    ).toBeGreaterThan(5);
  });

  it("shows the gap BEFORE the body moves, which is why it is not just bytes", () => {
    // The load-bearing half of the argument. The one-key body is ~5.7x smaller
    // but the response is ~11.3x faster, so transfer cannot explain it. First
    // byte is what separates "the server thinks for longer" from "there is more
    // to download" — and only the first supports asking for fewer keys.
    const firstByte = (keyCount: number): number =>
      median(
        armOf(keyCount)
          .map((row) => row.firstByteMs)
          .filter((ms): ms is number => Number.isFinite(ms)),
      );

    expect(firstByte(32) / firstByte(1)).toBeGreaterThan(5);
  });

  it("separates the arms WITHIN each operator, not only in aggregate", () => {
    // Rules out the alternative explanation: that the fast arm happened to be
    // served by faster hosts. Every operator with samples in both arms must
    // show the same direction, or the aggregate is an artefact of scheduling.
    let compared = 0;
    for (const operator of new Set(served.map((row) => row.operator))) {
      const fast = armOf(1)
        .filter((row) => row.operator === operator)
        .map((row) => row.totalMs)
        .filter((ms): ms is number => Number.isFinite(ms));
      const slow = armOf(32)
        .filter((row) => row.operator === operator)
        .map((row) => row.totalMs)
        .filter((ms): ms is number => Number.isFinite(ms));
      if (fast.length === 0 || slow.length === 0) continue;
      compared += 1;
      expect(
        median(slow),
        `${operator} answered one key and 32 keys at the same speed, which ` +
          `would mean the aggregate difference is about which hosts served ` +
          `which arm rather than about the query`,
      ).toBeGreaterThan(median(fast));
    }

    // THE GUARD ON THE GUARD. With no operator present in both arms the loop
    // above asserts nothing, and a test that asserts nothing looks exactly like
    // a passing one.
    expect(
      compared,
      "no operator had samples in both arms, so the within-operator control " +
        "asserted nothing",
    ).toBeGreaterThan(1);
  });
});
