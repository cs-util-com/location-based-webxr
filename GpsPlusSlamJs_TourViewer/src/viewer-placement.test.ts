import { describe, expect, it, vi } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import type { TourViewerSeams } from "./seams.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  type TourViewerSession,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";

/**
 * Why these tests matter (M5 review #15): the scan gate's pure rules live
 * in scan-gate.ts, but the DRIVER - the escape clock, the button, the
 * re-arm per tour, the levels outcome - had only the e2e. These pin the
 * driver's state transitions against a fake clock and a fake button, in
 * the order the app calls them.
 */

const LOCKABLE: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  },
};
const SIZE_ONLY: QrLevel = { version: 1, qr: { physicalSizeM: 0.2 } };

function harness(input: {
  mode?: "creator" | "visitor";
  status?: "idle" | "running";
  hasDetector?: boolean;
}) {
  const ctx: TourViewerSession = createTourViewerSession();
  let status = input.status ?? "running";
  const timers: (() => void)[] = [];
  const cancelled: number[] = [];
  const seams = {
    schedule: (fn: () => void) => {
      timers.push(fn);
      const index = timers.length - 1;
      return () => {
        cancelled.push(index);
      };
    },
    createQrFrontEnd: () =>
      (input.hasDetector ?? true)
        ? { kind: "barcode-detector", detect: () => Promise.resolve(null) }
        : null,
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => null,
  } as unknown as TourViewerSeams;
  const hooks = createUnwiredHooks();
  hooks.renderArStatus = vi.fn();
  const listeners: (() => void)[] = [];
  const escapeButton = {
    hidden: true,
    addEventListener: (_type: string, fn: () => void) => {
      listeners.push(fn);
    },
  } as unknown as HTMLButtonElement;
  const arStore = createTourViewerStore();
  const placement = createViewerPlacement({
    ctx,
    mode: input.mode ?? "visitor",
    arStore,
    arController: {
      getState: () => ({ status }),
    } as never,
    seams,
    errorBox: { textContent: "" } as HTMLElement,
    escapeButton,
    hooks,
  });
  // The app starts the pipeline (which learns whether a detector exists)
  // before it derives the gate; the harness follows that order.
  placement.startViewerPipeline();
  let fixes = 0;
  return {
    ctx,
    placement,
    arStore,
    /** One device fix through the page's own path (the coordinator sets
     *  the zero first when the session has none). */
    deviceFix: () => {
      if (arStore.getState().gpsData?.zero == null) {
        arStore.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
      }
      fixes += 1;
      const fix: RecordGpsEventPayload = {
        odomPosition: [fixes, 0, 0],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: `fix-${String(fixes)}`,
          latitude: 47.5,
          longitude: 8.7 + fixes * 1e-5,
          altitude: 400,
          latLongAccuracy: 6,
          timestamp: 1_790_000_000_000 + fixes * 1000,
        },
      };
      placement.recordDeviceFix(fix);
    },
    escapeButton,
    timers,
    cancelled,
    tapEscape: () => {
      for (const fn of listeners) fn();
    },
    setStatus: (next: "idle" | "running") => {
      status = next;
    },
  };
}

describe("viewer-placement - the scan gate driver (M5)", () => {
  it("a session that is not running has no gate; a running visitor session with unknown levels scans with the clock armed", () => {
    const h = harness({ status: "idle" });
    h.placement.startScanGate();
    expect(h.ctx.scanGate).toEqual({ kind: "idle" });
    expect(h.timers).toHaveLength(0);
    h.setStatus("running");
    h.placement.startScanGate();
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
    expect(h.timers).toHaveLength(1);
    expect(h.escapeButton.hidden).toBe(true);
  });

  it("a creator's gate is not required, and arms no clock (M5 review #11)", () => {
    const h = harness({ mode: "creator" });
    h.placement.startScanGate();
    expect(h.ctx.scanGate).toEqual({ kind: "not-required", reason: "creator" });
    expect(h.timers).toHaveLength(0);
  });

  it("the clock offers the escape; the tap passes the gate as skipped, once", () => {
    const h = harness({});
    h.placement.startScanGate();
    // GPS to continue with: a device fix arrived in this AR entry.
    h.deviceFix();
    h.timers[0]?.();
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: true });
    expect(h.escapeButton.hidden).toBe(false);
    h.tapEscape();
    expect(h.ctx.scanGate).toEqual({ kind: "passed", via: "skipped" });
    expect(h.escapeButton.hidden).toBe(true);
    // Idempotent: a second tap (or a lock after the escape) changes nothing.
    h.tapEscape();
    expect(h.ctx.scanGate).toEqual({ kind: "passed", via: "skipped" });
  });

  it("levels that cannot lock waive the gate and cancel the clock; levels that can leave it scanning (DEC-N4)", () => {
    const waived = harness({});
    waived.placement.startScanGate();
    waived.placement.reconsiderScanGate(new Map([["a", SIZE_ONLY]]));
    expect(waived.ctx.scanGate).toEqual({
      kind: "not-required",
      reason: "no-lockable-level",
    });
    expect(waived.cancelled).toEqual([0]);
    const kept = harness({});
    kept.placement.startScanGate();
    kept.placement.reconsiderScanGate(new Map([["a", LOCKABLE]]));
    expect(kept.ctx.scanGate).toEqual({
      kind: "scanning",
      escapeOffered: false,
    });
    expect(kept.cancelled).toEqual([]);
  });

  it("levels that could not be read waive the gate with their own reason (M5 review #1)", () => {
    const h = harness({});
    h.placement.startScanGate();
    h.placement.reconsiderScanGate("unavailable");
    expect(h.ctx.scanGate).toEqual({
      kind: "not-required",
      reason: "levels-unavailable",
    });
    expect(h.cancelled).toEqual([0]);
  });

  it("a tour close resets the gate and its clock; the next tour derives its own (M5 review #8)", () => {
    const h = harness({});
    h.placement.startScanGate();
    h.placement.reconsiderScanGate(new Map([["a", SIZE_ONLY]]));
    expect(h.ctx.scanGate.kind).toBe("not-required");
    h.placement.resetScanGate();
    expect(h.ctx.scanGate).toEqual({ kind: "idle" });
    expect(h.escapeButton.hidden).toBe(true);
    // The next tour, with a lockable code, scans again instead of
    // inheriting the waiver.
    h.placement.startScanGate();
    h.placement.reconsiderScanGate(new Map([["b", LOCKABLE]]));
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
    expect(h.timers).toHaveLength(2);
  });

  // Why these matter: "Continue with GPS only" promises a placement by GPS.
  // Indoors a phone may hold the location permission and never get a fix;
  // the escape then led to a screen that could place nothing. It waits for
  // a device fix of THIS AR entry - the session origin survives an AR exit,
  // so "an origin exists" says nothing about GPS being here now.
  it("no device fix when the clock runs out: no escape; the first fix after it offers the escape", () => {
    const h = harness({});
    h.placement.startScanGate();
    h.timers[0]?.(); // 10 s, no fix yet
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
    expect(h.escapeButton.hidden).toBe(true);
    h.deviceFix(); // 15 s: the first fix
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: true });
    expect(h.escapeButton.hidden).toBe(false);
    h.tapEscape();
    expect(h.ctx.scanGate).toEqual({ kind: "passed", via: "skipped" });
  });

  it("a fix before the clock runs out does not offer the escape early", () => {
    const h = harness({});
    h.placement.startScanGate();
    h.deviceFix();
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
    expect(h.escapeButton.hidden).toBe(true);
    h.timers[0]?.();
    expect(h.escapeButton.hidden).toBe(false);
  });

  it("an origin kept from an earlier AR entry is not a fix of this one: no escape", () => {
    const h = harness({});
    // The origin of an earlier entry survives the AR exit; this entry's
    // GPS history is empty.
    h.arStore.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    h.placement.startScanGate();
    h.timers[0]?.();
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
    expect(h.escapeButton.hidden).toBe(true);
  });

  it("a start without location arms no escape clock, and a fix changes nothing (codes only)", () => {
    const h = harness({});
    h.ctx.codesOnly = true;
    h.placement.startScanGate();
    expect(h.timers).toHaveLength(0);
    h.deviceFix();
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
    expect(h.escapeButton.hidden).toBe(true);
  });

  it("a fix after the gate passed or was torn down offers nothing", () => {
    const h = harness({});
    h.placement.startScanGate();
    h.timers[0]?.();
    h.placement.reconsiderScanGate(new Map([["a", SIZE_ONLY]]));
    h.deviceFix();
    expect(h.escapeButton.hidden).toBe(true);
    expect(h.ctx.scanGate.kind).toBe("not-required");
    // A new entry's gate has its own clock: an elapsed clock of the old
    // one does not offer the escape on its first fix.
    h.placement.startScanGate();
    h.deviceFix();
    expect(h.ctx.scanGate).toEqual({ kind: "scanning", escapeOffered: false });
  });

  it("a browser without a detector is waived at once (DEC-N13)", () => {
    const h = harness({ hasDetector: false });
    h.placement.startScanGate();
    expect(h.ctx.scanGate).toEqual({
      kind: "not-required",
      reason: "no-detector",
    });
    expect(h.timers).toHaveLength(0);
  });
});
