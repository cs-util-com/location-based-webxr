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
/** One try: the fallbacks' tests (the retries have their own). */
const ONCE = { attempts: 1 };

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

  // WHY (r816's browser run): at 5 s both synthetic landings read the
  // fallback on a loaded machine, and nothing corrected them: they landed
  // on the clearance, a ground found only near the end being a raise the
  // flight may no longer take. Measured elsewhere: real Terrarium requests
  // up to 3.4 s, AWS z13 up to 7.9 s (R4c). A late ground costs nothing (a
  // replan while a link's flight is still thousands of km up), so each try
  // waits twice the slowest measured, and a failed or slow try is tried
  // again; all of it within a link's minute of flight.
  it("waits twice the slowest measured read, and retries within a link's flight", () => {
    expect(LANDING_GROUND.timeoutMs).toBeGreaterThanOrEqual(2 * 7_900);
    expect(LANDING_GROUND.attempts).toBeGreaterThanOrEqual(2);
    let worst = 0;
    for (let i = 0; i < LANDING_GROUND.attempts; i++) {
      worst += LANDING_GROUND.timeoutMs;
      if (i > 0) worst += LANDING_GROUND.backoffMs * 2 ** (i - 1);
    }
    expect(worst).toBeLessThanOrEqual(60_000);
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
    await expect(readLandingGroundM(null, LUCERNE, ONCE)).resolves.toEqual(
      fallback,
    );
    await expect(
      readLandingGroundM(source([undefined]), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([]), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([Number.NaN]), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source(new Error("offline")), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([300]), { lat: Number.NaN, lng: 8 }, ONCE),
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
        ONCE,
      ),
    ).resolves.toEqual(fallback);
  });

  // WHY (the R4b milestone review, findings 7, 8 and 10): a source that
  // answers something other than an array must not reject the read; a
  // height outside the plugin's own plausible range (-500 to 9,000 m) is a
  // decoding fault, not ground; and beyond Web Mercator's 85.05 degrees the
  // tile at the clamped latitude is ground about 550 km away.
  it("falls back for a non-array answer, an implausible height and a place past Mercator", async () => {
    const fallback = { groundM: 0, source: "fallback" };
    const odd = (answer: unknown): GroundSource => ({
      elevationAt: () =>
        Promise.resolve(answer as readonly (number | undefined)[]),
    });
    await expect(
      readLandingGroundM(odd(undefined), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(readLandingGroundM(odd({}), LUCERNE, ONCE)).resolves.toEqual(
      fallback,
    );
    await expect(
      readLandingGroundM(source([9_500]), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([-600]), LUCERNE, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(source([8_800]), LUCERNE, ONCE),
    ).resolves.toEqual({ groundM: 8_800, source: "tile" });
    await expect(
      readLandingGroundM(source([-400]), LUCERNE, ONCE),
    ).resolves.toEqual({
      groundM: 0,
      source: "tile",
    });
    const polar = source([2_000]);
    await expect(
      readLandingGroundM(polar, { lat: 86, lng: 10 }, ONCE),
    ).resolves.toEqual(fallback);
    await expect(
      readLandingGroundM(polar, { lat: -85.2, lng: 10 }, ONCE),
    ).resolves.toEqual(fallback);
    expect(polar.asked).toEqual([]);
  });

  // WHY: a source that never answers must not hold the flight's ground:
  // at the timeout the ellipsoid stands in and the read is aborted.
  it("gives up at the timeout and aborts the read", async () => {
    vi.useFakeTimers();
    const s = source([435], 60_000);
    const read = readLandingGroundM(s, LUCERNE, {
      timeoutMs: 1_000,
      attempts: 1,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(s.signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(read).resolves.toEqual({ groundM: 0, source: "fallback" });
    expect(s.signals[0]?.aborted).toBe(true);
  });

  // WHY (r816's browser run, the coordinator's follow-up): a read that
  // failed or timed out was never tried again, so the flight landed on the
  // clearance with a minute of flight left. A failed or slow try is tried
  // again after a doubling backoff, up to LANDING_GROUND.attempts.
  it("tries a failed or slow read again, with a doubling backoff", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const flaky: GroundSource = {
      elevationAt: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("offline"));
        if (calls === 2) return new Promise(() => {}); // hangs
        return Promise.resolve([435]);
      },
    };
    const read = readLandingGroundM(flaky, LUCERNE, {
      timeoutMs: 1_000,
      backoffMs: 500,
      attempts: 3,
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(2);
    // The second try (from 500 ms) times out at 1,500 ms, then waits 1 s
    // (doubled): the third at 2,500 ms.
    await vi.advanceTimersByTimeAsync(1_998);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(3);
    await expect(read).resolves.toEqual({ groundM: 435, source: "tile" });
  });

  it("stops after its tries, and never retries a read that answered", async () => {
    vi.useFakeTimers();
    const down = source(new Error("offline"));
    const read = readLandingGroundM(down, LUCERNE, {
      backoffMs: 100,
      attempts: 3,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(read).resolves.toEqual({ groundM: 0, source: "fallback" });
    expect(down.asked).toHaveLength(3);
    const up = source([435]);
    const upRead = readLandingGroundM(up, LUCERNE);
    await vi.advanceTimersByTimeAsync(10);
    await expect(upRead).resolves.toEqual({ groundM: 435, source: "tile" });
    expect(up.asked).toHaveLength(1);
    // An implausible answer is an answer: tried again too, it is a fault.
    const odd = source([9_500]);
    const oddRead = readLandingGroundM(odd, LUCERNE, {
      backoffMs: 100,
      attempts: 2,
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(oddRead).resolves.toEqual({ groundM: 0, source: "fallback" });
    expect(odd.asked).toHaveLength(2);
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
