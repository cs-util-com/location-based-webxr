/**
 * The creator's print-size check (QR size consensus plan §11-§13, S3a).
 *
 * Why these tests matter: prints come out smaller than asked (the owner's
 * 16 cm print measured 15.45 cm, a print dialog's fit-to-page), and the
 * level then states the wrong size to every visitor. The check measures
 * the print by parallax while the creator walks, and offers the measured
 * size - but only once three independent windows agree past 2 % (plan §13:
 * silence on a correct print matters more than catching every misprint),
 * never while the code turns, at most once per code per session, and it
 * tells the creator to take a sideways step while it has no answer yet.
 */
import { describe, expect, it } from "vitest";
import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import type { QrParallaxSizeWindow } from "gps-plus-slam-app-framework/ar/qr";
import { createPrintSizeCheck } from "./print-size-check.js";

const still = { motion: { state: "still" } } as unknown as QrFusedPose;
const turning = { motion: { state: "turning" } } as unknown as QrFusedPose;

/** An estimator stand-in: independent windows 4 s apart of the given sizes. */
function windows(...sizes: number[]) {
  let i = 0;
  return (): QrParallaxSizeWindow | null => {
    const s = sizes[i];
    if (s === undefined) return null;
    const w = {
      sizeM: s,
      lateralBaselineM: 0.1,
      views: 32,
      oldestTimestamp: i * 4000,
      newestTimestamp: i * 4000 + 3875,
    };
    i += 1;
    return w;
  };
}

describe("createPrintSizeCheck", () => {
  it("offers the measured size once three independent windows agree", () => {
    const next = windows(0.1545, 0.155, 0.1552);
    const check = createPrintSizeCheck({ estimate: next });
    check.onDetection("A", still, 0.16);
    check.onDetection("A", still, 0.16);
    expect(check.offer()).toBeNull();
    expect(check.pending("A")).toBe(true);
    check.onDetection("A", still, 0.16);
    expect(check.offer()).toEqual({ text: "A", sizeM: 0.155 });
  });

  it("confirms a correct print quietly: no offer, no longer pending", () => {
    const check = createPrintSizeCheck({
      estimate: windows(0.159, 0.1605, 0.1598),
    });
    for (let i = 0; i < 3; i++) check.onDetection("A", still, 0.16);
    expect(check.offer()).toBeNull();
    expect(check.pending("A")).toBe(false);
  });

  // Parallax assumes a still code (plan §8): a turning read is not measured.
  it("does not measure while the code turns", () => {
    let calls = 0;
    const check = createPrintSizeCheck({
      estimate: () => {
        calls += 1;
        return null;
      },
    });
    check.onDetection("A", turning, 0.16);
    check.onDetection("A", null, 0.16);
    expect(calls).toBe(1);
  });

  it("asks once per code: kept or adopted, it does not come back", () => {
    const check = createPrintSizeCheck({
      estimate: windows(0.155, 0.155, 0.155, 0.15, 0.15, 0.15),
    });
    for (let i = 0; i < 3; i++) check.onDetection("A", still, 0.16);
    expect(check.offer()).not.toBeNull();
    check.answer("A", "kept");
    expect(check.offer()).toBeNull();
    expect(check.pending("A")).toBe(false);
    for (let i = 0; i < 3; i++) check.onDetection("A", still, 0.16);
    expect(check.offer()).toBeNull();
  });

  // The measured size does not depend on the typed one (nominal-size
  // solves), so the evidence survives the restart that adopting causes.
  it("keeps its evidence across an adoption and does not re-offer", () => {
    const check = createPrintSizeCheck({
      estimate: windows(0.155, 0.155, 0.155),
    });
    for (let i = 0; i < 3; i++) check.onDetection("A", still, 0.16);
    check.answer("A", "adopted");
    check.onDetection("A", still, 0.155);
    expect(check.offer()).toBeNull();
    expect(check.pending("A")).toBe(false);
  });

  it("keeps codes apart and forgets everything on reset", () => {
    const check = createPrintSizeCheck({
      estimate: windows(0.155, 0.155, 0.155, 0.155, 0.155, 0.155),
    });
    for (let i = 0; i < 3; i++) check.onDetection("A", still, 0.16);
    expect(check.pending("B")).toBe(true);
    check.reset();
    expect(check.offer()).toBeNull();
    expect(check.pending("A")).toBe(true);
  });
});
