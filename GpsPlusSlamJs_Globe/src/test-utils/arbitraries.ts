/**
 * Shared fast-check arbitraries for the globe's property tests.
 *
 * `fc.double({ min: 0, max: 1 })` draws among float representations, not
 * evenly: measured by the R4/R5 milestone review (2026-10-08), 92 % of its
 * draws were below 1e-6, 6 % exactly 1 and 0.06 % in [0.5, 0.99). A
 * property "at any moment of a flight" built on it almost never tested the
 * middle or the end of one, and a climb's corner and a replan's dip passed.
 */

// Types only: this file sits in the package's src, which the no-build lab
// must be able to serve (tests/repo-config/atmosphere-served-imports), and
// a type import never reaches the browser. The caller passes fast-check in.
import type FastCheck from "fast-check";
import type { Arbitrary } from "fast-check";

/** A share in [0, 1], even over the interval, with both ends drawn too. */
export function unitShare(fc: typeof FastCheck): Arbitrary<number> {
  return fc.oneof(
    fc.constant(0),
    fc.constant(1),
    fc.integer({ min: 0, max: 1_000_000 }).map((i) => i / 1_000_000),
  );
}
