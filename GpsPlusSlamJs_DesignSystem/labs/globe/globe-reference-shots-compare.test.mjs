/**
 * Tests for the reference-view comparison: the pixel difference, the
 * intro trace's difference and the script's verdict on missing views.
 *
 * Why this file matters: a refactor that must leave the globe looking the
 * same is judged by these numbers, so a difference that the counting
 * missed (a channel skipped, an off-by-one in the threshold) would pass a
 * visible change as identical.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import {
  VIEW_NAMES,
  diffRgba,
  diffTrace,
  dropRepeatedFrames,
  main,
} from "./globe-reference-shots-compare.mjs";

const rgba = (...pixels) => new Uint8Array(pixels.flat());

describe("diffRgba", () => {
  it("reads two equal images as no difference at all", () => {
    const a = rgba([10, 20, 30, 255], [0, 0, 0, 255]);
    const d = diffRgba(a, a.slice());
    assert.equal(d.max, 0);
    assert.deepEqual(Object.values(d.shares), [0, 0, 0, 0, 0]);
  });

  // Why: "identical" must be a measured zero; the smallest threshold of
  // one level read a one-level change as no change at all.
  it("counts a one-level change above 0 and not above 1", () => {
    const d = diffRgba(rgba([0, 0, 0, 255]), rgba([0, 1, 0, 255]));
    assert.equal(d.shares[">0"], 1);
    assert.equal(d.shares[">1"], 0);
  });

  it("counts a pixel by its largest channel, in every colour channel", () => {
    for (const channel of [0, 1, 2]) {
      const a = rgba([100, 100, 100, 255], [0, 0, 0, 255]);
      const b = a.slice();
      b[channel] += 5;
      const d = diffRgba(a, b);
      assert.equal(d.max, 5);
      // Over 1 and over 4: one pixel in two; not over 16.
      assert.equal(d.shares[">1"], 0.5);
      assert.equal(d.shares[">4"], 0.5);
      assert.equal(d.shares[">16"], 0);
    }
  });

  it("ignores alpha and counts strictly above a threshold", () => {
    const a = rgba([0, 0, 0, 255]);
    const d1 = diffRgba(a, rgba([0, 0, 0, 0]));
    assert.equal(d1.max, 0);
    const d4 = diffRgba(a, rgba([4, 0, 0, 255]));
    assert.equal(d4.shares[">1"], 1);
    assert.equal(d4.shares[">4"], 0);
  });

  it("draws the difference amplified, opaque", () => {
    const d = diffRgba(rgba([0, 0, 0, 255]), rgba([3, 0, 0, 255]), {
      gain: 10,
    });
    assert.deepEqual([...d.image], [30, 30, 30, 255]);
  });

  it("refuses buffers of different sizes", () => {
    assert.throws(() => diffRgba(rgba([0, 0, 0, 0]), new Uint8Array(8)));
  });
});

describe("diffTrace", () => {
  const frame = (d, offset) => ({
    cameraDistanceM: d,
    cameraDirection: [1, 0, 0],
    cloudLonOffsetRad: offset,
    dust: { on: false },
  });

  it("reads equal traces as null", () => {
    const a = [frame(1, 0), frame(2, 0.1)];
    assert.equal(diffTrace(a, structuredClone(a)), null);
  });

  // Why: the trace is how a refactor's invisible state change shows; the
  // first differing frame says where the paths part, the largest
  // difference says how far.
  it("names each differing field with its first frame and largest difference", () => {
    const a = [frame(1, 0), frame(2, 0.1), frame(3, 0.2)];
    const b = [frame(1, 0), frame(2.5, 0.1), frame(3, 0.25)];
    b[2].dust = { on: true };
    const d = diffTrace(a, b);
    assert.equal(d.fields.cameraDistanceM.firstFrame, 1);
    assert.equal(d.fields.cameraDistanceM.maxAbs, 0.5);
    assert.equal(d.fields.cloudLonOffsetRad.firstFrame, 2);
    assert.ok(Math.abs(d.fields.cloudLonOffsetRad.maxAbs - 0.05) < 1e-12);
    assert.equal(d.fields.dust.maxAbs, null);
    assert.equal(d.fields.cameraDirection, undefined);
  });

  it("reports traces of different lengths", () => {
    assert.deepEqual(diffTrace([frame(1, 0)], []), { lengths: [1, 0] });
  });
});

describe("dropRepeatedFrames", () => {
  // Why: the page can draw an animation frame without the clock moving,
  // and how often depends on scheduling; two runs of the same code then
  // differ in length only. A repeat carries no state, so dropping it loses
  // nothing, while a frame that differs in any field stays.
  it("drops a frame equal to the one before it, and only that", () => {
    const f = (d, o) => ({ cameraDistanceM: d, cloudLonOffsetRad: o });
    const t = [f(1, 0), f(1, 0), f(1, 0.1), f(2, 0.1), f(2, 0.1), f(1, 0)];
    assert.deepEqual(dropRepeatedFrames(t), [
      f(1, 0),
      f(1, 0.1),
      f(2, 0.1),
      f(1, 0),
    ]);
    assert.deepEqual(dropRepeatedFrames([]), []);
  });
});

describe("main", () => {
  const png = (dir, name) =>
    sharp({
      create: { width: 2, height: 2, channels: 4, background: "#123456" },
    })
      .png()
      .toFile(join(dir, `${name}.png`));

  const setup = async ({ missing = null } = {}) => {
    const root = mkdtempSync(join(tmpdir(), "shots-"));
    const [before, after, out] = ["before", "after", "out"].map((d) =>
      join(root, d),
    );
    for (const dir of [before, after]) {
      mkdirSync(dir);
      for (const name of VIEW_NAMES) {
        if (dir === before && name === missing) continue;
        await png(dir, name);
      }
      writeFileSync(join(dir, "trace.json"), "[]");
    }
    return { root, args: [before, after, out] };
  };

  // Why: the script read the view list from the before folder, so a view
  // the capture failed to write before the change passed as compared.
  it("fails when a fixed view is missing from the before side", async () => {
    const { root, args } = await setup({ missing: "3-approach" });
    try {
      assert.equal(await main(args), 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when every fixed view and the trace are on both sides", async () => {
    const { root, args } = await setup();
    try {
      assert.equal(await main(args), 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
