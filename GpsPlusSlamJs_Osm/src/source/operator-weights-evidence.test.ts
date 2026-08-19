/**
 * The shipped operator weights must still agree with the measurement they came
 * from.
 *
 * WHY THIS TEST EXISTS. `DEFAULT_OPERATOR_WEIGHTS` reverses a decision that was
 * itself taken on measured evidence, and the thing that makes the reversal
 * defensible is a committed artefact rather than a preference. This repo's
 * recorded failure mode is precisely that link rotting: three separate latency
 * figures have had to be formally retracted because a number outlived the run
 * that produced it and went on being quoted as current
 * (`tests/repo-config/retracted-osm-figures.test.js` in the webxr root exists
 * for the same reason).
 *
 * So this reads the artefact and checks the constant against it. It does NOT
 * re-measure anything and never touches the network — the run is on disk, and
 * the whole point of committing it was that the analysis could be re-run
 * offline whenever the constant is edited.
 *
 * WHERE IT LIVES, since DEC-T10 said `location-based-webxr/tests/repo-config/`.
 * It moved here, and the decision's own reasoning is why: it asked for the test
 * to sit "beside the artefact and inside a gate that actually runs it". The
 * artefact is in THIS package's `docs/`, and the constant it guards is one
 * directory away — so this location satisfies both clauses that the repo-config
 * directory only satisfied one of, and it needs no cross-package import.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_OPERATOR_WEIGHTS } from "./overpass-source.js";
import { operatorForUrl } from "./overpass-operators.js";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** The run the shipped weights were derived from. */
const ARTEFACT = "docs/overpass-sweep-2026-08-19-arealonly-res78.json";

interface SweepCell {
  readonly url: string;
  readonly operator: string;
  readonly res: number;
  readonly form: string;
  readonly ok: boolean;
  readonly totalMs: number;
}

interface Sweep {
  readonly measuredAt: string;
  readonly complete: boolean;
  readonly plannedCells: number;
  readonly results: readonly SweepCell[];
}

const sweep = JSON.parse(
  readFileSync(resolve(packageRoot, ARTEFACT), "utf8"),
) as Sweep;

/** Fraction of this operator's attempts that returned a body. */
function successRate(operator: string): number {
  const rows = sweep.results.filter((c) => c.operator === operator);
  if (rows.length === 0) return Number.NaN;
  return rows.filter((c) => c.ok).length / rows.length;
}

describe("the shipped operator weights against their evidence", () => {
  it("was measured on the query form production actually sends", () => {
    // THE ERROR THIS CATCHES IS SILENT AND WOULD PROPAGATE INTO A CONSTANT. The
    // benchmark script's DEFAULT mode measures the `nwr` form, which production
    // retired on 2026-08-03 for a 3.2x smaller payload. Weights derived from a
    // run of the wrong form would be a precise measurement of a query nobody
    // sends. The artefact records its own form; this asserts it is the shipped
    // one.
    expect(sweep.results.length).toBeGreaterThan(0);
    expect(new Set(sweep.results.map((c) => c.form))).toEqual(
      new Set(["areal-only"]),
    );
  });

  it("names every operator with the SAME table production retries by", () => {
    // A drift here would mean the evidence groups hosts one way and the client
    // groups them another, so the weights would be attached to buckets that do
    // not exist at runtime.
    for (const cell of sweep.results) {
      expect(cell.operator).toBe(operatorForUrl(cell.url));
    }
  });

  it("does not weight a MORE reliable operator below a less reliable one", () => {
    // THE ASSERTION THAT ACTUALLY GUARDS THE CONSTANT. Latency here does not
    // replicate well enough to pin an ordering on medians — the repo has three
    // retracted figures making exactly that point — but availability does: an
    // operator that answered one attempt in four is not a coin-flip away from
    // one that answered five in six.
    //
    // Stated as "not inverted" rather than "exactly proportional", because the
    // weights are deliberately coarse tiers. It fails when someone raises a
    // failing operator above a working one, which is the edit worth catching,
    // and stays quiet about the tier sizes, which the data cannot settle.
    const operators = [...new Set(sweep.results.map((c) => c.operator))];
    const MATERIAL = 0.25;

    for (const a of operators) {
      for (const b of operators) {
        if (a === b) continue;
        if (successRate(a) - successRate(b) <= MATERIAL) continue;
        const weightA = DEFAULT_OPERATOR_WEIGHTS[a] ?? 1;
        const weightB = DEFAULT_OPERATOR_WEIGHTS[b] ?? 1;
        expect(
          weightA,
          `${a} answered ${(successRate(a) * 100).toFixed(0)}% of attempts and ` +
            `${b} answered ${(successRate(b) * 100).toFixed(0)}%, so ${a} must ` +
            `not be weighted below ${b}`,
        ).toBeGreaterThanOrEqual(weightB);
      }
    }
  });

  it("weights every operator the measurement actually covered", () => {
    // An operator in the pool with no weight silently falls back to the neutral
    // default, which is the uniform draw the 2026-07-28 measurement removed. If
    // the run covered it, the constant should have an opinion about it.
    for (const operator of new Set(sweep.results.map((c) => c.operator))) {
      expect(Object.keys(DEFAULT_OPERATOR_WEIGHTS)).toContain(operator);
    }
  });

  it("records whether the run finished, so a partial one cannot read as whole", () => {
    // A budget-truncated sweep is a legitimate artefact and a misleading one if
    // its truncation is invisible. So this checks the flag AGREES with the row
    // count, in both directions, rather than demanding it be `true` — a partial
    // run is allowed to be the evidence, but it is not allowed to claim it
    // finished.
    //
    // Written as one unconditional comparison rather than an `if` around an
    // assertion: `vitest/no-conditional-expect` is right that a conditional
    // expect can silently assert nothing, and here the unconditional form is
    // also the stronger claim.
    expect(sweep.complete).toBe(sweep.results.length >= sweep.plannedCells);
  });
});
