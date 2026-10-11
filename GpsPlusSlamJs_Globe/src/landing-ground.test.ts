/**
 * Why this test matters: the landing is 150 m above the GROUND (round-4
 * plan 2026-10-11-0122 DEC-R4-1), so the flight needs the ground under its
 * target before it plans its line; read late, a raise turns the view (the
 * cold review, §6 item 3). The read is one Terrarium tile at the relief's
 * own zoom (R13: one height source) and must never hang the flight or
 * reject: a missing source (`relief=0`), a failed, empty, non-finite or
 * slow read is the ellipsoid (0). A later revision from the relief comes
 * only past a margin, so the relief's own sampling of the same tile never
 * replans the flight.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { GLOBE_TERRAIN } from "./globe-terrain.js";
import {
  LANDING_GROUND,
  groundRevisionM,
  readLandingGroundM,
  type GroundSource,
} from "./landing-ground.js";

const LUCERNE = { lat: 47.0502, lng: 8.3093 };

/** A source answering `heights` (or rejecting with `error`) after `delayMs`. */
function source(
  answer: readonly (number | undefined)[] | Error,
  delayMs = 0,
): GroundSource & { asked: unknown[]; signals: (AbortSignal | undefined)[] } {
  const asked: unknown[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  return {
    asked,
    signals,
    elevationAt(positions, signal) {
      asked.push(positions);
      signals.push(signal);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (answer instanceof Error) reject(answer);
          else resolve(answer);
        }, delayMs);
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LANDING_GROUND", () => {
  // R13: the landing, the relief and the city read one height source at one
  // zoom, so the landing's ground is the relief's own number.
  it("reads the relief's own zoom", () => {
    expect(LANDING_GROUND.zoom).toBe(GLOBE_TERRAIN.maxZoom);
  });
});

describe("readLandingGroundM", () => {
  it("reads the ground under the place", async () => {
    const s = source([435.5]);
    await expect(readLandingGroundM(s, LUCERNE)).resolves.toEqual({
      groundM: 435.5,
      source: "tile",
    });
    expect(s.asked).toEqual([[LUCERNE]]);
  });

  it("draws the sea at 0: a depth reads as the ellipsoid's own height", async () => {
    await expect(readLandingGroundM(source([-42]), LUCERNE)).resolves.toEqual({
      groundM: 0,
      source: "tile",
    });
  });

  it("falls back to the ellipsoid without a source, data, a finite height or an answer", async () => {
    const fallback = { groundM: 0, source: "fallback" };
    await expect(readLandingGroundM(null, LUCERNE)).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([undefined]), LUCERNE),
    ).resolves.toEqual(fallback);
    await expect(readLandingGroundM(source([]), LUCERNE)).resolves.toEqual(
      fallback,
    );
    await expect(
      readLandingGroundM(source([Number.NaN]), LUCERNE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source(new Error("offline")), LUCERNE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([300]), { lat: Number.NaN, lng: 8 }),
    ).resolves.toEqual(fallback);
    // A source that throws instead of rejecting.
    await expect(
      readLandingGroundM(
        {
          elevationAt: () => {
            throw new Error("no canvas");
          },
        },
        LUCERNE,
      ),
    ).resolves.toEqual(fallback);
  });

  // WHY: a source that never answers must not hold the flight's ground:
  // at the timeout the ellipsoid stands in and the read is aborted.
  it("gives up at the timeout and aborts the read", async () => {
    vi.useFakeTimers();
    const s = source([435], 60_000);
    const read = readLandingGroundM(s, LUCERNE, { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(s.signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(read).resolves.toEqual({ groundM: 0, source: "fallback" });
    expect(s.signals[0]?.aborted).toBe(true);
  });

  it("takes an answer that comes before the timeout", async () => {
    vi.useFakeTimers();
    const read = readLandingGroundM(source([1_200], 900), LUCERNE, {
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(901);
    await expect(read).resolves.toEqual({ groundM: 1_200, source: "tile" });
  });

  it("stops with its caller's signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const s = source([435], 60_000);
    const read = readLandingGroundM(s, LUCERNE, { signal: controller.signal });
    controller.abort();
    expect(s.signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(LANDING_GROUND.timeoutMs + 1);
    await expect(read).resolves.toEqual({ groundM: 0, source: "fallback" });
    const before = new AbortController();
    before.abort();
    await expect(
      readLandingGroundM(source([435]), LUCERNE, { signal: before.signal }),
    ).resolves.toEqual({ groundM: 0, source: "fallback" });
  });
});

describe("groundRevisionM", () => {
  it("revises only past the margin, never below the sea, never without a relief height", () => {
    expect(groundRevisionM(435, 440)).toBeNull();
    expect(groundRevisionM(435, 435 + LANDING_GROUND.marginM)).toBeNull();
    expect(groundRevisionM(0, 435)).toBe(435);
    expect(groundRevisionM(600, 435)).toBe(435);
    expect(groundRevisionM(435, null)).toBeNull();
    expect(groundRevisionM(435, Number.NaN)).toBeNull();
    expect(groundRevisionM(100, -50)).toBe(0);
    expect(groundRevisionM(10, -50)).toBeNull();
  });

  // WHY (measured in flight-ground.test.ts): a raise turns the meteor's
  // view by 0.01 degree or less (pinGround takes it only while the camera
  // stands well over the new ground), but a LOWERED ground puts the
  // camera above its line and turns the view by about 30-50 x (drop over
  // height) degrees: 1.0 for 165 m at 5 km, 3.5 at 2 km. So a lowering
  // comes only while the drop is at most `lowerPerHeight` of the camera's
  // height above the ground (0.4-0.6 degree); later the flight lands
  // that much higher instead.
  it("lowers only while the drop is small against the camera's height; offers a raise", () => {
    const k = LANDING_GROUND.lowerPerHeight;
    expect(groundRevisionM(600, 435, { heightM: 165 / k - 1 })).toBeNull();
    expect(groundRevisionM(600, 435, { heightM: 165 / k + 1 })).toBe(435);
    expect(groundRevisionM(600, 435, { heightM: 20_000 })).toBe(435);
    expect(groundRevisionM(600, 435, { heightM: 5_000 })).toBeNull();
    // A raise is offered at any height: whether the flight can take it
    // from where its camera is decides pinGround (PIN_FLIGHT.raisePerHeight).
    expect(groundRevisionM(0, 435, { heightM: 3_000 })).toBe(435);
    expect(groundRevisionM(600, 435)).toBe(435);
  });

  // A revision is followed by the same relief height again on the next
  // frame: it must then do nothing (no replan every frame).
  it("settles: a revised ground is never revised again by the same height", () => {
    expect(() =>
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 9_000, noNaN: true }),
          fc.double({ min: -500, max: 9_000, noNaN: true }),
          fc.double({ min: 0, max: 200, noNaN: true }),
          (current, relief, margin) => {
            const next = groundRevisionM(current, relief, { marginM: margin });
            // No revision within the margin; a revision past it, never below
            // the sea, and none again for the same relief height.
            return next === null
              ? Math.abs(Math.max(0, relief) - current) <= margin
              : next >= 0 &&
                  Math.abs(next - current) > margin &&
                  groundRevisionM(next, relief, { marginM: margin }) === null;
          },
        ),
      ),
    ).not.toThrow();
  });
});
