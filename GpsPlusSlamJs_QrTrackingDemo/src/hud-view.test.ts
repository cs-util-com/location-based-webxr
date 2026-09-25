/**
 * HUD view-model — unit tests.
 *
 * Why this matters: the developer reads the running median off this HUD to
 * confirm a freshly printed QR against a tape measure, so the cm/mm formatting
 * and the lifecycle labels must be exact.
 */

import { describe, it, expect } from "vitest";
import { MOTION_COLORS, toHudView } from "./hud-view";

describe("toHudView", () => {
  it("shows placeholders when no size is known yet", () => {
    const v = toHudView("scanning", undefined);
    expect(v.statusLabel).toMatch(/scanning/i);
    expect(v.sizeLabel).toBe("—");
    expect(v.sampleLabel).toBe("0 samples");
    expect(v.lifecycleLabel).toBe("unknown");
  });

  it("formats the median in cm and the spread in mm", () => {
    const v = toHudView("tracking", {
      status: "estimated",
      estimateM: 0.201,
      sampleCount: 12,
      spreadM: 0.004,
    });
    expect(v.statusLabel).toMatch(/Locked/);
    expect(v.sizeLabel).toBe("20.1 cm");
    expect(v.sampleLabel).toBe("12 samples");
    expect(v.spreadLabel).toBe("±4 mm");
    expect(v.lifecycleLabel).toBe("estimated");
  });

  it("shows a sub-mm spread as '<1 mm', not '±0 mm'", () => {
    // The robust half-width (1.4826·MAD/√N) goes sub-mm once the estimate
    // converges; rounding it to ±0 mm read as false precision on device.
    const v = toHudView("tracking", {
      status: "estimated",
      estimateM: 0.018,
      sampleCount: 238,
      spreadM: 0.0002, // 0.2 mm
    });
    expect(v.spreadLabel).toBe("<1 mm");
  });

  it("keeps '±0 mm' for a genuine zero spread (no samples yet)", () => {
    const v = toHudView("scanning", undefined);
    expect(v.spreadLabel).toBe("±0 mm");
  });

  it("uses the singular 'sample' for exactly one", () => {
    const v = toHudView("scanning", {
      status: "measuring",
      estimateM: 0.2,
      sampleCount: 1,
      spreadM: 0,
    });
    expect(v.sampleLabel).toBe("1 sample");
  });

  it("shows 'measuring…' while measuring with no median yet", () => {
    const v = toHudView("scanning", {
      status: "measuring",
      estimateM: null,
      sampleCount: 0,
      spreadM: 0,
    });
    expect(v.sizeLabel).toBe("measuring…");
  });
});

describe("toHudView pose line (M3b b5)", () => {
  // Why this test matters: on the phone the owner sees the axis settle, but
  // not WHY - whether the joint rotation over several views is shown, or
  // the fallback to averaging, and how well the views agree. This line says
  // it, so a field test can tell a good window from a contradicting one.
  const fused = (over: Record<string, unknown>) =>
    ({
      status: "stable",
      pose: null,
      method: "joint",
      views: 7,
      droppedViews: 0,
      fitPx: 0.62,
      windowEntries: 7,
      averagedRotationDeltaDeg: 1.2,
      frameEpoch: 0,
      oldestTimestamp: 0,
      newestTimestamp: 0,
      motion: null,
      ...over,
    }) as Parameters<typeof toHudView>[2];

  it("reads '—' before any fused evaluation", () => {
    expect(toHudView("idle", undefined, null).poseLabel).toBe("—");
    expect(
      toHudView(
        "scanning",
        undefined,
        fused({ status: "unknown", method: null }),
      ).poseLabel,
    ).toBe("—");
  });

  // b5 review #7: the row must say what the OVERLAY shows. The overlay
  // takes the fused pose only while it is stable; otherwise it shows the
  // raw frame pose, and the row says so first.
  it("names the fused pose when the overlay shows it, else the raw one", () => {
    expect(toHudView("tracking", undefined, fused({})).poseLabel).toBe(
      "fused joint · 7 views · fit 0.6 px",
    );
    expect(
      toHudView("tracking", undefined, fused({ status: "measuring", views: 3 }))
        .poseLabel,
    ).toBe("raw (fused measuring · 3 views · fit 0.6 px)");
    expect(
      toHudView("tracking", undefined, fused({ status: "measuring", views: 1 }))
        .poseLabel,
    ).toBe("raw (fused measuring · 1 view · fit 0.6 px)");
  });

  it("names the fallback when the views contradict each other", () => {
    expect(
      toHudView(
        "tracking",
        undefined,
        fused({ status: "measuring", method: "averaged", fitPx: 12.34 }),
      ).poseLabel,
    ).toBe("raw (views disagree · fit 12.3 px)");
  });

  it("shows a missing fit as '—'", () => {
    expect(
      toHudView(
        "tracking",
        undefined,
        fused({ status: "measuring", method: "averaged", fitPx: Infinity }),
      ).poseLabel,
    ).toBe("raw (views disagree · fit —)");
  });
});

describe("toHudView motion line (plan §26)", () => {
  // Why this test matters: the owner asked to SEE the motion mode on the
  // phone - a label with the speeds and a colour per mode - to judge the
  // detector in tests A (a still wall code must read "still") and E (a
  // hand-held code). A still code keeps the design system's own colour.
  const motion = (over: Record<string, unknown>) =>
    ({
      status: "measuring",
      pose: null,
      method: "joint",
      views: 1,
      droppedViews: 0,
      fitPx: 0,
      windowEntries: 1,
      averagedRotationDeltaDeg: 0,
      frameEpoch: 0,
      oldestTimestamp: 0,
      newestTimestamp: 0,
      motion: {
        state: "still",
        moving: false,
        turning: false,
        stillSinceMs: null,
        movingCandidate: false,
        turningCandidate: false,
        offsetM: 0,
        speedMps: 0.123,
        newestFitPx: 0.5,
        turnRateDegPerS: 35.2,
        ...over,
      },
    }) as Parameters<typeof toHudView>[2];

  it("reads '—' without a motion reading", () => {
    expect(toHudView("idle", undefined, null).motionLabel).toBe("—");
    const v = toHudView("tracking", undefined, motion({}));
    expect(
      toHudView("tracking", undefined, { ...v, motion: null } as never)
        .motionLabel,
    ).toBe("—");
  });

  it("reads a still code as 'still' in the default colour", () => {
    const v = toHudView("tracking", undefined, motion({}));
    expect(v.motionLabel).toBe("still");
    expect(v.motionColor).toBeNull();
  });

  it("names each mode with its speeds", () => {
    const label = (over: Record<string, unknown>) =>
      toHudView("tracking", undefined, motion(over)).motionLabel;
    expect(label({ state: "moving", moving: true })).toBe("moving · 12 cm/s");
    expect(label({ state: "turning", turning: true })).toBe("turning · 35°/s");
    expect(
      label({ state: "turning", turning: true, turnRateDegPerS: null }),
    ).toBe("turning");
    expect(
      label({ state: "moving+turning", moving: true, turning: true }),
    ).toBe("moving + turning · 12 cm/s · 35°/s");
  });

  it("gives each motion mode its own colour", () => {
    const colors = (["moving", "turning", "moving+turning"] as const).map(
      (state) =>
        toHudView("tracking", undefined, motion({ state })).motionColor,
    );
    expect(colors.every((c) => typeof c === "string")).toBe(true);
    expect(new Set(colors).size).toBe(3);
    expect(MOTION_COLORS.moving).toBe(colors[0]);
  });
});
