import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CUT_SETTINGS, cutSettingsOf } from "./cut-settings.js";
import { blankImage, drawScaled } from "./rgba-image.js";
import { cutBackground, findFigures } from "./sheet-cut.js";
import { leaks, syntheticSheet } from "./test-support/synthetic-sheet.js";

// Why these tests matter: an image AI varies the figure's colour, the
// picture's size and its compression noise from sheet to sheet; the cut must
// keep the whole figure, leave no stray piece and find four poses with their
// feet on the line for every such sheet, not only for the one drawn in the
// example tests.
describe("cutBackground and findFigures over varied sheets", () => {
  it("keep each figure whole, leak nothing and find the four feet", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 560, max: 900 }),
          share: fc.double({ min: 0.4, max: 0.65, noNaN: true }),
          fill: fc.tuple(
            fc.integer({ min: 20, max: 200 }),
            fc.integer({ min: 20, max: 200 }),
            fc.integer({ min: 20, max: 200 }),
          ),
          noise: fc.integer({ min: 0, max: 4 }),
          seed: fc.integer({ min: 1, max: 1_000_000 }),
        }),
        ({ width, share, fill, noise, seed }) => {
          const height = Math.round(width * 0.62);
          const sheet = syntheticSheet({
            width,
            height,
            figureShare: share,
            fill,
            noise,
            seed,
          });
          const cut = cutBackground(sheet.image, CUT_SETTINGS);
          let lost = 0;
          sheet.truth.forEach((t, i) => {
            if (t === 1 && cut.alpha[i] === 0) {
              lost++;
            }
          });
          expect(lost).toBe(0);
          expect(leaks(cut.alpha, sheet.truth, width).pixels).toBe(0);
          const f = findFigures(cut.alpha, width, height, CUT_SETTINGS);
          expect(f.runs).toHaveLength(4);
          f.runs.forEach((r, i) => {
            expect(Math.abs(r.y1 - sheet.feet[i]!)).toBeLessThanOrEqual(1);
          });
        },
      ),
      { numRuns: 12 },
    );
  });
});

// Why this test matters: the settings arrive from a page (sliders, a stored
// choice) across a Worker boundary; whatever arrives, the cut must run on
// finite values inside the allowed ranges, and reading twice changes nothing.
describe("cutSettingsOf", () => {
  it("always yields finite settings with only the known keys", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(...Object.keys(CUT_SETTINGS), "other"),
          fc.oneof(
            fc.double(),
            fc.integer(),
            fc.string(),
            fc.boolean(),
            fc.constant(null),
          ),
        ),
        (input) => {
          const s = cutSettingsOf(input);
          expect(Object.keys(s).sort()).toEqual(
            Object.keys(CUT_SETTINGS).sort(),
          );
          for (const v of Object.values(s)) {
            expect(
              typeof v === "boolean" || (typeof v === "number" && isFinite(v)),
            ).toBe(true);
          }
          expect(cutSettingsOf(s)).toEqual(s);
        },
      ),
    );
  });
});

// Why this test matters: the frames are resampled by area averaging; a
// uniform picture must stay that colour at any scale, or the frames would
// get a tint or a seam the prototype's canvas never showed.
describe("drawScaled", () => {
  it("keeps a uniform colour at any scale", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.tuple(
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
        ),
        (sw, sh, dw, dh, [r, g, b]) => {
          const src = blankImage(sw, sh);
          for (let i = 0; i < sw * sh; i++) {
            src.data.set([r, g, b, 255], i * 4);
          }
          const dst = blankImage(dw, dh);
          drawScaled(src, 0, 0, sw, sh, dst, 0, 0, dw, dh);
          for (let i = 0; i < dw * dh; i++) {
            expect(
              Math.abs(dst.data[i * 4]! - r) +
                Math.abs(dst.data[i * 4 + 1]! - g) +
                Math.abs(dst.data[i * 4 + 2]! - b),
            ).toBeLessThanOrEqual(3);
            expect(dst.data[i * 4 + 3]).toBeGreaterThanOrEqual(254);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
