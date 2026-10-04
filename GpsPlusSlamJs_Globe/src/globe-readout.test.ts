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
