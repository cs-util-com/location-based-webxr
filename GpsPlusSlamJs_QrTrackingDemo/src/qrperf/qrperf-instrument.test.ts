/**
 * Why these tests matter: the instrument sits between the demo's real
 * pipeline and the numbers on the owner's screenshot. It must (1) never change
 * what the pipeline returns, (2) attribute each duration to the right stage,
 * (3) run zxing only in `zxing` mode, only after the native decode and on the
 * SAME image, and (4) score corner order only when both decoders found the
 * code. A wrapper that silently altered a detection would corrupt the very
 * session it is measuring.
 */

import { describe, expect, it, vi } from "vitest";
import type { QrDetection, RgbaImage } from "gps-plus-slam-app-framework/ar";
import {
  createQrPerfInstrument,
  type ZxingProbe,
} from "./qrperf-instrument.js";

const IMAGE: RgbaImage = {
  data: new Uint8ClampedArray(4 * 4 * 4),
  width: 4,
  height: 4,
};
const CORNERS: QrDetection["corners"] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const HIT: QrDetection = { text: "code", corners: CORNERS };

/** A clock that advances by `step` ms on every read. */
function steppingClock(step: number): () => number {
  let t = 0;
  return () => (t += step);
}

describe("createQrPerfInstrument", () => {
  it("records blit/readback and flip-copy per capture, and counts captures", () => {
    const inst = createQrPerfInstrument({
      mode: "native",
      baseline: false,
      now: () => 1000,
    });
    inst.onCaptureTiming({
      blitReadbackMs: 3,
      flipCopyMs: 1,
      width: 1024,
      height: 768,
    });
    const snap = inst.snapshot();
    expect(snap.stages["blit+readback"]?.median).toBe(3);
    expect(snap.stages["flip-copy"]?.median).toBe(1);
    expect(snap.ratesPerSec.capture).toBeGreaterThan(0);
  });

  it("times detect without changing its result, and counts hits", async () => {
    const inst = createQrPerfInstrument({
      mode: "native",
      baseline: false,
      now: steppingClock(5),
    });
    const detect = inst.wrapDetect(() => Promise.resolve(HIT));
    await expect(detect(IMAGE)).resolves.toBe(HIT);
    const snap = inst.snapshot();
    expect(snap.stages.detect?.median).toBe(5);
    expect(snap.ratesPerSec.detect).toBeGreaterThan(0);
    expect(snap.ratesPerSec.hit).toBeGreaterThan(0);
  });

  it("times the solve and passes its result through", () => {
    const inst = createQrPerfInstrument({
      mode: "native",
      baseline: false,
      now: steppingClock(2),
    });
    const solve = inst.wrapSolve((x: number) => x * 2);
    expect(solve(21)).toBe(42);
    expect(inst.snapshot().stages.solve?.median).toBe(2);
  });

  it("never touches zxing in native mode", async () => {
    const probe: ZxingProbe = { decode: vi.fn(), loadMs: () => null };
    const inst = createQrPerfInstrument({
      mode: "native",
      baseline: false,
      zxing: probe,
    });
    await inst.wrapDetect(() => Promise.resolve(HIT))(IMAGE);
    expect(probe.decode).not.toHaveBeenCalled();
  });

  it("in zxing mode decodes the SAME image after native, alternating option sets, and tallies corner order", async () => {
    const calls: string[] = [];
    const probe: ZxingProbe = {
      decode: vi.fn((image: RgbaImage, set: "default" | "fast") => {
        calls.push(set);
        expect(image).toBe(IMAGE);
        return Promise.resolve({
          ms: 4,
          result: { corners: [...CORNERS], rotationDeg: 0 },
        });
      }),
      loadMs: () => 800,
    };
    const inst = createQrPerfInstrument({
      mode: "zxing",
      baseline: false,
      zxing: probe,
    });
    const detect = inst.wrapDetect(() => Promise.resolve(HIT));
    await detect(IMAGE);
    await detect(IMAGE);
    expect(calls).toEqual(["default", "fast"]);
    expect(inst.cornerOrder()).toEqual({
      0: { identity: 2, other: 0, permutations: ["0123"] },
    });
    expect(inst.snapshot().stages["zxing-default"]?.median).toBe(4);
  });

  it("does not score corner order when the native decoder found nothing", async () => {
    const probe: ZxingProbe = {
      decode: vi.fn(() =>
        Promise.resolve({
          ms: 4,
          result: { corners: [...CORNERS], rotationDeg: 0 },
        }),
      ),
      loadMs: () => null,
    };
    const inst = createQrPerfInstrument({
      mode: "zxing",
      baseline: false,
      zxing: probe,
    });
    await inst.wrapDetect(() => Promise.resolve(null))(IMAGE);
    expect(inst.cornerOrder()).toEqual({});
  });

  it("keeps the native result when the zxing probe throws", async () => {
    const probe: ZxingProbe = {
      decode: vi.fn(() => Promise.reject(new Error("wasm gone"))),
      loadMs: () => null,
    };
    const inst = createQrPerfInstrument({
      mode: "zxing",
      baseline: false,
      zxing: probe,
    });
    await expect(
      inst.wrapDetect(() => Promise.resolve(HIT))(IMAGE),
    ).resolves.toBe(HIT);
  });

  it("renders a screenshot-readable report and a parseable JSON copy", async () => {
    const inst = createQrPerfInstrument({
      mode: "native",
      baseline: true,
      now: steppingClock(1),
    });
    inst.onCaptureTiming({
      blitReadbackMs: 3,
      flipCopyMs: 1,
      width: 1024,
      height: 768,
    });
    inst.onXrFrame(1 / 30);
    await inst.wrapDetect(() => Promise.resolve(HIT))(IMAGE);
    const lines = inst.report();
    expect(lines[0]).toContain("native");
    expect(lines[0]).toContain("BASELINE");
    expect(lines[0]).toContain("1024x768");
    expect(lines.join("\n")).toContain("blit+readback");
    const json = JSON.parse(inst.json()) as { mode: string; stages: object };
    expect(json.mode).toBe("native");
    expect(json.stages).toHaveProperty("detect");
  });

  it("reports capture cost per second and all-time totals that outlive the rolling windows", async () => {
    let t = 0;
    const inst = createQrPerfInstrument({
      mode: "native",
      baseline: false,
      now: () => t,
    });
    inst.onCaptureTiming({
      blitReadbackMs: 3,
      flipCopyMs: 1,
      width: 8,
      height: 8,
    });
    await inst.wrapDetect(() => Promise.resolve(HIT))(IMAGE);
    t = 60_000; // a minute later: the 10 s rate window is empty
    const report = inst.report().join("\n");
    expect(report).toContain("capture cost 0.0 ms/s");
    expect(report).toMatch(/since start: captures 1 {2}detects 1 {2}hits 1/);
  });

  it("tallies native and zxing hits on the SAME frames, per option set", async () => {
    const probe: ZxingProbe = {
      decode: vi.fn((_image: RgbaImage, set: "default" | "fast") =>
        Promise.resolve({
          ms: 4,
          result:
            set === "default"
              ? { corners: [...CORNERS], rotationDeg: 0 }
              : null,
        }),
      ),
      loadMs: () => 800,
    };
    const inst = createQrPerfInstrument({
      mode: "zxing",
      baseline: false,
      zxing: probe,
    });
    const detect = inst.wrapDetect(() => Promise.resolve(HIT));
    for (let k = 0; k < 4; k++) await detect(IMAGE);
    const report = inst.report().join("\n");
    expect(report).toContain("default: frames 2  native 2  zxing 2  both 2");
    expect(report).toContain("fast: frames 2  native 2  zxing 0  both 0");
  });

  it("does not count frames the probe skipped (malformed buffers)", async () => {
    const probe: ZxingProbe = {
      decode: vi.fn(() =>
        Promise.resolve({ ms: 0, result: null, skipped: true }),
      ),
      loadMs: () => null,
    };
    const inst = createQrPerfInstrument({
      mode: "zxing",
      baseline: false,
      zxing: probe,
    });
    await inst.wrapDetect(() => Promise.resolve(HIT))(IMAGE);
    expect(inst.snapshot().stages["zxing-default"]).toBeUndefined();
    expect(inst.report().join("\n")).toContain("default: frames 0");
  });

  describe("pose quality (QR near-frontal pose plan, M1)", () => {
    const CAMERA = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const solveWith =
      (rotation: number[], reprojectionErrorPx = 0.4) =>
      (_input: unknown) => ({
        qrPoseWorld: { position: [0, 0, -1], rotation },
        reprojectionErrorPx,
      });
    const tilt = (deg: number) => {
      const h = (deg * Math.PI) / 360;
      return [0, Math.sin(h), 0, Math.cos(h)];
    };

    // Why this test matters: the phone's before/after for the pose fix reads
    // these numbers; they must pair the solve with the detection of the same
    // frame (the code's text comes from the detect wrapper).
    it("feeds each solve, with the detected text, into the pose numbers", async () => {
      const inst = createQrPerfInstrument({ mode: "native", baseline: false });
      const detect = inst.wrapDetect(() => Promise.resolve(HIT));
      const input = { imagePoints: CORNERS, cameraPose: CAMERA };
      await detect(IMAGE);
      inst.wrapSolve(solveWith([0, 0, 0, 1]))(input);
      await detect(IMAGE);
      inst.wrapSolve(solveWith(tilt(4)))(input);
      const json = JSON.parse(inst.json()) as { pose: { pairs: number } };
      expect(json.pose.pairs).toBe(1);
      expect(inst.report().join("\n")).toMatch(/pose jumps .*p50 4\.0/);
    });

    // Why this test matters: the wrapper is generic and must stay harmless for
    // a solve it cannot read, or for a failed solve (null).
    it("ignores solves it cannot read and failed solves", async () => {
      const inst = createQrPerfInstrument({ mode: "native", baseline: false });
      await inst.wrapDetect(() => Promise.resolve(HIT))(IMAGE);
      expect(inst.wrapSolve((x: number) => x * 2)(21)).toBe(42);
      expect(
        inst.wrapSolve((_input: unknown) => null)({
          imagePoints: CORNERS,
          cameraPose: CAMERA,
        }),
      ).toBeNull();
      const json = JSON.parse(inst.json()) as {
        pose: { reprojectionPx: { n: number } };
      };
      expect(json.pose.reprojectionPx.n).toBe(0);
      expect(inst.report().join("\n")).toContain("pose: no solves yet");
    });

    it("reports the capture interval it runs at", () => {
      const inst = createQrPerfInstrument({
        mode: "native",
        baseline: false,
        intervalMs: 60,
      });
      expect(inst.report()[0]).toContain("interval 60 ms");
      expect(
        (JSON.parse(inst.json()) as { intervalMs: number }).intervalMs,
      ).toBe(60);
    });
  });
});
