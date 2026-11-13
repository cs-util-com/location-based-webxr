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
    // Twelve full cuts of sheets up to 900 px wide take a few seconds alone;
    // a loaded runner must not turn that into a timeout.
  }, 30_000);

  // Why this test matters: the cut keeps a light grey figure only because
  // its outline stops the background fill. The synthetic sheet once clipped
  // pose 4's raised arm at a window narrower than the arm plus its outline,
  // so the arm's tip touched the background without an outline; a random
  // run then drew a grey fill whose noise reached the shadow floor and the
  // fill took that pixel as shadow. This is that run's sheet (the fourth
  // pose is index 3 in the generator's `pose()`).
  it("keeps the arm tip of a light grey figure (seeded counterexample)", () => {
    const width = 892;
    const sheet = syntheticSheet({
      width,
      height: Math.round(width * 0.62),
      figureShare: 0.5596745027124774,
      fill: [166, 166, 168],
      noise: 4,
      seed: 788901,
    });
    const cut = cutBackground(sheet.image, CUT_SETTINGS);
    const lost = sheet.truth.filter((t, i) => t === 1 && cut.alpha[i] === 0);
    expect(lost.length).toBe(0);
  });
});

/** A figure share near 0.56 whose figure height H makes `0.3 * H` a whole
 *  number: the raised arm's tip then lands exactly on a pixel column, the
 *  case in which the generator once left the tip open. Derived rather than
 *  hard-coded, so the case survives a change of the sheet's size. */
function wholeArmShare(height: number): { share: number; H: number } {
  for (let H = Math.round(0.56 * height); H > 0; H--) {
    if (Number.isInteger(0.3 * H)) {
      return { share: H / height, H };
    }
  }
  throw new Error(`no whole arm reach below ${height}`);
}

/** Figure pixels that are not outline ink but touch the background. */
function openPixels(
  sheet: ReturnType<typeof syntheticSheet>,
  width: number,
  ink: number,
): number {
  const d = sheet.image.data;
  const t = sheet.truth;
  let open = 0;
  t.forEach((v, i) => {
    const x = i % width;
    const touches =
      (x > 0 && t[i - 1] === 0) ||
      (x < width - 1 && t[i + 1] === 0) ||
      t[i - width] === 0 ||
      t[i + width] === 0;
    if (v === 1 && touches && d[i * 4] !== ink) {
      open++;
    }
  });
  return open;
}

// Why this test matters: the cut's tests assume every outlined synthetic
// figure is closed by its outline (the sidecar's "an outlined grey figure is
// safe at every grey" rests on it). A figure pixel that is not outline ink
// but touches the background means the generator drew an open figure, and a
// failing cut test would then blame the cut for the generator's gap. Two
// generator gaps are covered on purpose: the raised arm's tip on a whole
// pixel column (a derived share, asserted below so it cannot silently stop
// being whole), and a talking pose's body shifted far enough sideways to
// leave a drawing window that once assumed the arm was the widest part (a
// jitter above 0.13 * H + 1).
describe("syntheticSheet", () => {
  it("closes every figure with its outline", () => {
    const ink = 34;
    for (const width of [560, 700, 892, 900]) {
      const height = Math.round(width * 0.62);
      const whole = wholeArmShare(height);
      expect(Number.isInteger(0.3 * whole.H)).toBe(true);
      expect(Math.round(whole.share * height)).toBe(whole.H);
      for (const figureShare of [0.4, whole.share, 0.65]) {
        const H = Math.round(figureShare * height);
        const far = Math.ceil(0.13 * H) + 3;
        for (const talkJitter of [0, far, -far]) {
          const sheet = syntheticSheet({
            width,
            height,
            figureShare,
            fill: [190, 190, 190],
            talkJitter,
          });
          expect({
            width,
            figureShare,
            talkJitter,
            open: openPixels(sheet, width, ink),
          }).toEqual({ width, figureShare, talkJitter, open: 0 });
        }
      }
    }
  }, 30_000);
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
