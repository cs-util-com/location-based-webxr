/**
 * Why this test matters: the owner will read altitudes off this line to
 * name where the cloud fade-in of the flight should start (round-4 plan
 * 2026-09-28-2105 DEC-GL4-5). A readout that jumps between units, rounds
 * 1,500 km to "2e+3", flickers its last digit on every frame, or prints
 * "NaN km" when the camera's numbers are momentarily bad would make those
 * names wrong or unreadable on a phone. The throttle is pure, so the rate
 * the page writes the DOM at is tested here, not guessed in a browser.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_READOUT,
  formatDistance,
  globeReadoutText,
  landedLineText,
  readoutThrottle,
} from "./globe-readout.js";

describe("formatDistance", () => {
  it("uses whole km from 100 km, one decimal from 1 km, metres below", () => {
    expect(formatDistance(20_180_000)).toBe("20,180 km");
    expect(formatDistance(150_000)).toBe("150 km");
    expect(formatDistance(99_950)).toBe("100 km");
    expect(formatDistance(45_640)).toBe("45.6 km");
    expect(formatDistance(1_000)).toBe("1.0 km");
    expect(formatDistance(999.4)).toBe("999 m");
    expect(formatDistance(12)).toBe("12 m");
    expect(formatDistance(0)).toBe("0 m");
  });

  it("clamps a camera a hair under the ellipsoid to 0 and says unknown for a bad number", () => {
    expect(formatDistance(-3)).toBe("0 m");
    expect(formatDistance(Number.NaN)).toBe("unknown");
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  // The printed number must read back as the distance within its rounding,
  // for every finite distance up to the Moon: that is what makes the owner's
  // named altitude the one the camera was at.
  it("reads back within its rounding step, for any distance", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 4e8, noNaN: true }), (m) => {
        const text = formatDistance(m);
        const value = Number(text.replace(/[^\d.]/g, ""));
        const metres = text.endsWith(" km") ? value * 1000 : value;
        const step = m >= 99_950 ? 1000 : m >= 999.5 ? 100 : 1;
        expect(Math.abs(metres - m)).toBeLessThanOrEqual(step / 2 + 1e-6);
      }),
    );
  });
});

describe("globeReadoutText", () => {
  it("names the altitude, and the distance to the target only while there is one", () => {
    expect(
      globeReadoutText({ altitudeM: 25_000_000, targetDistanceM: null }),
    ).toBe("Altitude 25,000 km");
    expect(
      globeReadoutText({ altitudeM: 1_234_000, targetDistanceM: 1_300_000 }),
    ).toBe("Altitude 1,234 km · 1,300 km to the target");
  });

  // WHY (the owner on r812, round-4 plan DEC-R4-1): "the readout's 400 m
  // was nearer 100 m above the roofs": the altitude is above the
  // ellipsoid, so near the ground the line also says how high above the
  // GROUND the camera is. Only below GLOBE_READOUT.groundBelowM, where the
  // two differ visibly, and only where the ground is known.
  it("names the height above the ground beside the altitude, near the ground", () => {
    expect(
      globeReadoutText({
        altitudeM: 585,
        targetDistanceM: null,
        groundM: 435,
      }),
    ).toBe("Altitude 585 m · 150 m above ground");
    expect(
      globeReadoutText({
        altitudeM: 2_400,
        targetDistanceM: 300,
        groundM: 2_000,
      }),
    ).toBe("Altitude 2.4 km · 400 m above ground · 300 m to the target");
    expect(
      globeReadoutText({
        altitudeM: 585,
        targetDistanceM: null,
        groundM: null,
      }),
    ).toBe("Altitude 585 m");
    expect(
      globeReadoutText({
        altitudeM: GLOBE_READOUT.groundBelowM,
        targetDistanceM: null,
        groundM: 1_000,
      }),
    ).toBe("Altitude 100 km");
    // Over the sea the drawn ground is 0, as the clearance draws it: a
    // bathymetric depth under the camera never adds to the height (the R4b
    // milestone review, finding 4).
    expect(
      globeReadoutText({ altitudeM: 150, targetDistanceM: null, groundM: -40 }),
    ).toBe("Altitude 150 m · 150 m above ground");
    // A camera a hair under the drawn ground reads 0, never negative.
    expect(
      globeReadoutText({ altitudeM: 430, targetDistanceM: null, groundM: 435 }),
    ).toBe("Altitude 430 m · 0 m above ground");
  });
});

// WHY (the R4b milestone review, finding 2, and r816's browser run): the
// landed line says the readout's number, the camera's height above the
// drawn ground under it. With no relief height there yet it waited, and in
// r816's city flight the height never came, so the owner would have read
// a bare "Arrived." forever. It waits at most GLOBE_READOUT.landedWaitMs,
// then says the altitude above sea level, which is always true.
describe("landedLineText", () => {
  it("says the height above the ground, or above the sea without a relief", () => {
    expect(
      landedLineText({ aboveGroundM: 158.4, altitudeM: 2_298, waitedMs: 0 }),
    ).toBe("Arrived, 158 m above the ground.");
    expect(
      landedLineText({ aboveGroundM: null, altitudeM: 150, waitedMs: 0 }),
    ).toBe("Arrived, 150 m above sea level.");
  });

  it("waits for the relief's height, but never longer than the bound", () => {
    const wait = GLOBE_READOUT.landedWaitMs;
    expect(
      landedLineText({
        aboveGroundM: undefined,
        altitudeM: 1_473,
        waitedMs: 0,
      }),
    ).toBeNull();
    expect(
      landedLineText({
        aboveGroundM: undefined,
        altitudeM: 1_473,
        waitedMs: wait - 1,
      }),
    ).toBeNull();
    expect(
      landedLineText({
        aboveGroundM: undefined,
        altitudeM: 1_473,
        waitedMs: wait,
      }),
    ).toBe("Arrived, 1.5 km above sea level.");
    expect(wait).toBeGreaterThanOrEqual(2_000);
    expect(wait).toBeLessThanOrEqual(15_000);
  });
});

describe("readoutThrottle", () => {
  // At most GLOBE_READOUT.intervalMs apart, and only a changed text is
  // written: a DOM write per frame would be 60 layout invalidations a
  // second for a number nobody can read that fast.
  it("writes a changed text at most once per interval, and never an unchanged one", () => {
    const writes: string[] = [];
    const throttle = readoutThrottle((t) => writes.push(t));
    throttle.offer("a", 0);
    throttle.offer("b", GLOBE_READOUT.intervalMs - 1);
    throttle.offer("b", GLOBE_READOUT.intervalMs);
    throttle.offer("b", 3 * GLOBE_READOUT.intervalMs);
    throttle.offer("c", 3 * GLOBE_READOUT.intervalMs + 1);
    throttle.offer("c", 4 * GLOBE_READOUT.intervalMs + 1);
    expect(writes).toEqual(["a", "b", "c"]);
  });

  it("writes at a rate a person can read: between 2 and 10 updates a second", () => {
    expect(1000 / GLOBE_READOUT.intervalMs).toBeGreaterThanOrEqual(2);
    expect(1000 / GLOBE_READOUT.intervalMs).toBeLessThanOrEqual(10);
  });
});
