/**
 * The legend must be renderable for ANY scale the sheet can produce.
 *
 * Why this test matters:
 * `heat-colours.ts` carries a scar: with `threshold = 0` the log ramp divides
 * `-Infinity` by `-Infinity`, `toHex` emits `#NaNNaNNaN`, Leaflet treats that as
 * an invalid fill and drops the path — so one bad edit to a public Google Sheet
 * blanks the entire map while every score is still fine. Thresholds come from
 * that sheet through `toNumber`, which accepts `0` and negatives.
 *
 * The legend now samples the same ramp, which means it can reproduce the same
 * failure in a new place — and a legend that renders `#NaNNaNNaN` is worse than
 * the map doing it, because the legend is what a reader consults to find out
 * whether the map is lying.
 *
 * @see legend-model.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { legendModel } from "./legend-model.js";

/** Includes the values the live sheet has actually produced, and the hostile ones. */
const scoreArb = fc.oneof(
  fc.constantFrom(0, 1, 0.5, 2, 8, 1587),
  fc.double({ min: -100, max: 10000, noNaN: true }),
);

const scaleArb = fc.record({ threshold: scoreArb, max: scoreArb });

describe("legendModel is total over every scale the sheet can produce", () => {
  it("never emits a colour that is not `#rrggbb`", () => {
    fc.assert(
      fc.property(
        scaleArb,
        fc.string(),
        fc.boolean(),
        (scale, category, show) => {
          const model = legendModel(scale, category, show);
          for (const stop of [...model.ramp, ...model.bands]) {
            expect(stop.colour).toMatch(/^#[0-9a-f]{6}$/);
          }
        },
      ),
    );
  });

  it("never emits a label containing NaN or Infinity", () => {
    // A legend reading "1 … NaN" is a bug report the reader cannot act on.
    fc.assert(
      fc.property(scaleArb, fc.boolean(), (scale, show) => {
        const model = legendModel(scale, "walkable", show);
        const labels = [
          model.minLabel,
          model.maxLabel,
          ...model.bands.map((b) => b.label),
        ];
        for (const label of labels) {
          expect(label).not.toMatch(/NaN|Infinity/);
        }
      }),
    );
  });

  it("passes the category through verbatim, whatever the sheet calls it", () => {
    // Category names are column headers from a publicly editable sheet. The
    // model must not sanitise them — `legend-view.ts` avoids the HTML sink
    // entirely with `textContent`, and a model that silently rewrote the name
    // would make the on-screen label disagree with the `<select>`.
    fc.assert(
      fc.property(fc.string(), (category) => {
        expect(
          legendModel({ threshold: 1, max: 8 }, category, true).category,
        ).toBe(category);
      }),
    );
  });

  it("shows bands exactly when asked, and always all three", () => {
    fc.assert(
      fc.property(scaleArb, fc.boolean(), (scale, show) => {
        const bands = legendModel(scale, "walkable", show).bands;
        expect(bands).toHaveLength(show ? 3 : 0);
      }),
    );
  });
});
