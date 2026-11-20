import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Matrix4 } from "gps-plus-slam-app-framework/core";
import { SEGMENTING_ACTION_TYPES } from "gps-plus-slam-app-framework/state/segmenting-actions";

import {
  buildSyntheticRecording,
  SYNTHETIC_PROJECTION,
} from "../test-support/synthetic-recording.js";
import { ASPECT_TOL, PROJ_TOL, readSplatInputs } from "./recording-reader.js";

/**
 * Why these properties matter: the example tests pin one walk each; here
 * the walk's length, spacing, timing, wrapping folder, missing photos,
 * era and lens jitter vary, and the reader must keep every pose, count
 * every skip, measure the walk exactly and refuse exactly the recordings
 * the rules say - for any such walk, not only the ones written down.
 */

const RUNS = { numRuns: 25 };

/** The projection elements the lens is made of (focal and centre terms). */
const LENS_ELEMENTS: readonly number[] = [0, 5, 8, 9];

describe("readSplatInputs (property)", () => {
  it("keeps every pose with a photo, counts the rest, and measures the kept path", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        fc.double({ min: 0.05, max: 3, noNaN: true }),
        fc.integer({ min: 50, max: 5000 }),
        fc.constantFrom("", "walk/", "a/b/"),
        fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
        async (frames, spacingM, intervalMs, folder, dropMask) => {
          const missing = [...Array(frames).keys()].filter((i) => dropMask[i]);
          fc.pre(missing.length < frames);
          const rec = await buildSyntheticRecording({
            frames,
            spacingM,
            intervalMs,
            folder,
            missingPhotos: missing,
          });
          const read = await readSplatInputs(rec.file);
          if (read.kind !== "read") throw new Error(read.reason);
          const kept = [...Array(frames).keys()].filter(
            (i) => !missing.includes(i),
          );
          const { captures, census } = read.inputs;
          expect(captures.map((c) => c.entry)).toEqual(
            kept.map((i) => rec.photoEntries[i]),
          );
          expect(captures.map((c) => [c.position, c.rotation])).toEqual(
            kept.map((i) => [rec.poses[i]?.position, rec.poses[i]?.rotation]),
          );
          expect(census.frames).toBe(kept.length);
          expect(census.skippedFrames).toBe(missing.length);
          const first = kept[0] ?? 0;
          const last = kept[kept.length - 1] ?? 0;
          expect(census.pathM).toBeCloseTo((last - first) * spacingM, 9);
          expect(census.medianSpacingM === null).toBe(kept.length < 2);
          expect(census.medianSpacingS === null).toBe(kept.length < 2);
        },
      ),
      RUNS,
    );
  });

  it("gives an evenly spaced walk's own spacing as its medians", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        fc.double({ min: 0.05, max: 3, noNaN: true }),
        fc.integer({ min: 50, max: 5000 }),
        async (frames, spacingM, intervalMs) => {
          const rec = await buildSyntheticRecording({
            frames,
            spacingM,
            intervalMs,
          });
          const read = await readSplatInputs(rec.file);
          if (read.kind !== "read") throw new Error(read.reason);
          expect(read.inputs.census.medianSpacingM).toBeCloseTo(spacingM, 9);
          expect(read.inputs.census.medianSpacingS).toBeCloseTo(
            intervalMs / 1000,
            9,
          );
        },
      ),
      RUNS,
    );
  });

  it("accepts exactly eras 4 and 5, and never a moved coordinate frame", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.integer({ min: -2, max: 9 }),
          fc.double({ min: 0, max: 9, noNaN: true }),
          fc.constantFrom<unknown>(undefined, null, "5", true),
        ),
        fc.option(fc.constantFrom(...SEGMENTING_ACTION_TYPES), {
          nil: undefined,
        }),
        async (era, midWalkActionType) => {
          const rec = await buildSyntheticRecording({
            frames: 3,
            era,
            ...(midWalkActionType === undefined ? {} : { midWalkActionType }),
          });
          const read = await readSplatInputs(rec.file);
          const accepted =
            (era === 4 || era === 5) && midWalkActionType === undefined;
          expect(read.kind).toBe(accepted ? "read" : "refused");
        },
      ),
      RUNS,
    );
  });

  /** A three-capture walk whose second depth sample has element
   *  `element` moved by `magnitude` times its scale (the larger of its
   *  magnitude and 1, the tolerance's own floor), with the spread that
   *  move must report. */
  async function jittered(
    element: number,
    magnitude: number,
    negative: boolean,
  ): Promise<{ file: File; spread: number }> {
    const base = SYNTHETIC_PROJECTION[element] ?? 0;
    const delta = (negative ? -1 : 1) * magnitude * Math.max(Math.abs(base), 1);
    const moved = [...SYNTHETIC_PROJECTION];
    moved[element] = base + delta;
    const rec = await buildSyntheticRecording({
      frames: 3,
      projectionAt: (i) =>
        i === 1 ? (moved as unknown as Matrix4) : SYNTHETIC_PROJECTION,
    });
    return {
      file: rec.file,
      spread:
        Math.abs(delta) / Math.max(Math.abs(base), Math.abs(base + delta), 1),
    };
  }

  it("accepts lens jitter within the tolerance and reports its spread", async () => {
    // The spread is at most `magnitude`, so below the tolerance it reads.
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...LENS_ELEMENTS),
        fc.double({ min: 0, max: 0.99 * PROJ_TOL, noNaN: true }),
        fc.boolean(),
        async (element, magnitude, negative) => {
          const { file, spread } = await jittered(element, magnitude, negative);
          const read = await readSplatInputs(file);
          if (read.kind !== "read") throw new Error(read.reason);
          expect(read.inputs.census.projectionSpread).toBeCloseTo(spread, 12);
        },
      ),
      RUNS,
    );
  });

  it("refuses lens jitter beyond the tolerance", async () => {
    // The spread is at least magnitude / (1 + magnitude), above the
    // tolerance for every magnitude drawn here.
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...LENS_ELEMENTS),
        fc.double({ min: 1.01 * PROJ_TOL, max: 0.1, noNaN: true }),
        fc.boolean(),
        async (element, magnitude, negative) => {
          const { file } = await jittered(element, magnitude, negative);
          const read = await readSplatInputs(file);
          expect(read.kind === "refused" ? read.reason : "read").toMatch(
            /^The camera's lens changed during the recording/,
          );
        },
      ),
      RUNS,
    );
  });

  it("never counts the projection's other elements as a change of lens", async () => {
    // Why: elements other than 0, 5, 8 and 9 (the clip planes among them)
    // do not enter the lens; moving them must neither refuse nor show as
    // spread.
    await fc.assert(
      fc.asyncProperty(
        fc
          .integer({ min: 0, max: 15 })
          .filter((e) => !LENS_ELEMENTS.includes(e)),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        async (element, magnitude, negative) => {
          const { file } = await jittered(element, magnitude, negative);
          const read = await readSplatInputs(file);
          if (read.kind !== "read") throw new Error(read.reason);
          expect(read.inputs.census.projectionSpread).toBe(0);
        },
      ),
      RUNS,
    );
  });

  it("reads a lens within the aspect tolerance of its photos and refuses one beyond it", async () => {
    // Why: the frustum's shape must match the photos' shape, or fx and fy
    // disagree and every view is stretched; a fraction of a percent, as
    // real lenses show, must still read.
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        async (stretch) => {
          fc.pre(Math.abs(Math.abs(stretch) - ASPECT_TOL) > 0.01 * ASPECT_TOL);
          const lens = [...SYNTHETIC_PROJECTION];
          lens[0] = (lens[0] ?? 0) * (1 + stretch);
          const rec = await buildSyntheticRecording({
            frames: 2,
            projectionAt: () => lens as unknown as Matrix4,
          });
          const read = await readSplatInputs(rec.file);
          if (Math.abs(stretch) < ASPECT_TOL) {
            expect(read.kind).toBe("read");
          } else {
            expect(read.kind === "refused" ? read.reason : "read").toMatch(
              /does not fit the shape of its photos/,
            );
          }
        },
      ),
      RUNS,
    );
  });
});
