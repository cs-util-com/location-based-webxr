/**
 * Tests for the reference capture's added views and the dive-time search.
 *
 * Why this file matters: the held-flight shots are compared between two
 * builds by their file names and their dive times. A name that collided
 * with one of the first seven would overwrite an old view, and a search
 * that returned a time where the flight is still far above the band (or
 * already far below it) would capture the wrong altitude without failing.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { VIEW_NAMES } from "./globe-reference-shots-compare.mjs";
import {
  ADDED_SHOT_NAMES,
  BAND_VIEWS,
  FLIGHT_HOLDS,
  diveTimeFor,
} from "./globe-reference-shots-views.mjs";

describe("the added views", () => {
  // Why: old captures must still compare, so the first seven names stay
  // and the added ones are numbered after them, each once.
  it("are numbered after the first seven, each name once", () => {
    assert.deepEqual(ADDED_SHOT_NAMES, [
      "8-shell-band-120km",
      "9-shell-band-60km",
      "10-shell-band-20km",
      "11-flight-120km",
      "12-flight-60km",
      "13-flight-20km",
    ]);
    const all = [...VIEW_NAMES, ...ADDED_SHOT_NAMES];
    assert.equal(new Set(all).size, all.length);
  });

  it("look at the shell's bands at 120, 60 and 20 km", () => {
    assert.deepEqual(
      BAND_VIEWS.map((v) => [v.altitudeKm, v.pitchDeg]),
      [
        [120, -25],
        [60, -25],
        [20, -25],
      ],
    );
    assert.deepEqual(
      FLIGHT_HOLDS.map((h) => h.altitudeKm),
      [120, 60, 20],
    );
  });
});

describe("diveTimeFor", () => {
  /** A dive from 1000 km falling 1 km per second. */
  const linear = (ms) => 1_000_000 - ms;

  it("finds the time the dive passes the altitude, to well under a millisecond", async () => {
    const { ms, altitudeM } = await diveTimeFor(linear, 120_000);
    assert.ok(Math.abs(ms - 880_000) < 0.01, `ms ${ms}`);
    assert.ok(altitudeM <= 120_000 && altitudeM > 120_000 - 0.01);
  });

  it("reads through a page's promises", async () => {
    const { ms } = await diveTimeFor(async (t) => linear(t), 20_000);
    assert.ok(Math.abs(ms - 980_000) < 0.01);
  });

  it("holds at the start when the flight starts at or below the altitude", async () => {
    assert.deepEqual(await diveTimeFor(() => 50_000, 60_000), {
      ms: 0,
      altitudeM: 50_000,
    });
  });

  // Why: a pin flight may climb before it dives; the band must be found on
  // the way down, never at the start.
  it("finds the band on the way down of a flight that climbs first", async () => {
    const arc = (ms) =>
      ms < 100_000 ? 300_000 + ms : Math.max(0, 400_000 - (ms - 100_000));
    const { ms } = await diveTimeFor(arc, 60_000);
    assert.ok(Math.abs(ms - 440_000) < 0.01, `ms ${ms}`);
  });

  it("refuses a flight that never comes down to the altitude", async () => {
    await assert.rejects(
      diveTimeFor(() => 200_000, 120_000, { maxMs: 64_000 }),
      RangeError,
    );
  });

  it("refuses a page without a flight, and a bad altitude", async () => {
    await assert.rejects(
      diveTimeFor(() => null, 120_000),
      /no flight/,
    );
    await assert.rejects(diveTimeFor(linear, Number.NaN), RangeError);
    await assert.rejects(diveTimeFor(linear, -1), RangeError);
  });
});
