/**
 * How long the level-of-detail pass stays silent on one large primitive,
 * swept over the tube's size (opt-in, not a gate).
 *
 * Run with `LOD_SILENCE_SWEEP=1`, the rows going to `LOD_SILENCE_SWEEP_OUT`
 * (the runner keeps a test's console to itself):
 *   LOD_SILENCE_SWEEP=1 LOD_SILENCE_SWEEP_OUT=<file> pnpm run test:unit src/editor/asset-shelf/model-lod-silence.sweep.test.ts
 *
 * Why this exists: the page counts an optimizer Worker that sends nothing
 * for `OPTIMIZER_SILENCE_MS` as crashed, and the pass reports progress
 * after each step of a primitive's ordering and measurement. Whether that
 * value leaves a healthy run enough room rests on the longest gap between
 * two reports, which grows with the primitive. This sweep is the evidence
 * in model-lod.ts.md ("Cost") and optimizer-client.ts.md ("The value").
 *
 * WHAT IS MEASURED, per size: the skinned bending tube with its clip (three
 * clip poses and the rest pose) at the largest measured model's size (401
 * rings of 72, 57 600 triangles) and at about 4 and 16 times its triangles
 * (801 x 144 and 1 601 x 288); the whole pass's time at the default level,
 * the number of progress reports, and the longest gap between two of them
 * (the start and the end of the pass counted as reports).
 *
 * The one assertion is the premise: the pass reports during the primitive.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readGlb } from "./glb-file.js";
import { simplifyModel } from "./model-lod.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import { bendingTube } from "./test-support/glb-fixtures.js";

const RUN = process.env["LOD_SILENCE_SWEEP"] === "1";
const OUT = process.env["LOD_SILENCE_SWEEP_OUT"];

const SIZES = [
  { rings: 401, segments: 72 },
  { rings: 801, segments: 144 },
  { rings: 1601, segments: 288 },
] as const;

function row(text: string): void {
  if (OUT !== undefined) appendFileSync(OUT, `${text}\n`);
}

describe.runIf(RUN)("level-of-detail silence sweep", () => {
  it("measures the longest gap between progress reports", async () => {
    if (OUT !== undefined) writeFileSync(OUT, "");
    for (const { rings, segments } of SIZES) {
      const read = readGlb(await bendingTube({ clip: true, rings, segments }));
      if (!read.ok) throw new Error(read.reason);
      const beats: number[] = [];
      const start = performance.now();
      const report = simplifyModel(read.parts, OPTIMIZER_SETTINGS.model, () =>
        beats.push(performance.now()),
      );
      const end = performance.now();
      const marks = [start, ...beats, end];
      let gap = 0;
      for (let k = 1; k < marks.length; k++) {
        gap = Math.max(gap, marks[k]! - marks[k - 1]!);
      }
      row(
        JSON.stringify({
          rings,
          segments,
          triangles: report.trianglesBefore,
          trianglesAfter: report.trianglesAfter,
          seconds: +((end - start) / 1000).toFixed(1),
          reports: beats.length,
          longestGapSeconds: +(gap / 1000).toFixed(2),
        }),
      );
      expect(beats.length).toBeGreaterThan(2);
    }
  }, 3_600_000);
});
