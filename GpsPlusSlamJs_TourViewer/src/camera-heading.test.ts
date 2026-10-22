/**
 * Why these tests matter:
 * the radar is heading-up and the direction words follow the camera's
 * bearing. A phone held nearly flat over the ground has almost no
 * horizontal forward, so a degree of hand tremor swings that bearing by
 * tens of degrees and flips it across the vertical. Below a horizontal
 * share of the forward the heading is held; the share is swept, and the
 * sweep's verdict is pinned here so a change of the shipped value has to
 * face it.
 */
import { writeFileSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  cameraHeadingDeg,
  horizontalShare,
  WALK_HEADING_MIN_SHARE,
} from "./camera-heading";

/** A unit forward in NUE at a bearing, pitched `pitchDeg` down and rolled
 *  `rollDeg` about the bearing's horizontal axis. */
function pitched(
  bearingDeg: number,
  pitchDeg: number,
  rollDeg: number,
): [number, number, number] {
  const b = (bearingDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const t = (rollDeg * Math.PI) / 180;
  const along = Math.cos(p);
  const side = Math.sin(p) * Math.sin(t);
  return [
    along * Math.cos(b) - side * Math.sin(b),
    -Math.sin(p) * Math.cos(t),
    along * Math.sin(b) + side * Math.cos(b),
  ];
}

/** The signed smallest difference of two bearings, degrees. */
function delta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

describe("horizontalShare", () => {
  it("is the forward's horizontal part over its length", () => {
    expect(horizontalShare([1, 0, 0])).toBeCloseTo(1, 12);
    expect(horizontalShare([0, -1, 0])).toBe(0);
    expect(horizontalShare(pitched(40, 60, 0))).toBeCloseTo(0.5, 12);
    // Not unit length: the share is of its own length.
    expect(horizontalShare([3, -4, 0])).toBeCloseTo(0.6, 12);
  });

  it("is 0 for a forward that is no direction", () => {
    expect(horizontalShare([0, 0, 0])).toBe(0);
    expect(horizontalShare([Number.NaN, 0, 1])).toBe(0);
    expect(horizontalShare([1, Number.POSITIVE_INFINITY, 0])).toBe(0);
  });
});

describe("cameraHeadingDeg", () => {
  it("is the forward's bearing while it has enough of a horizontal part", () => {
    expect(cameraHeadingDeg([1, 0, 0], null)).toBeCloseTo(0, 9);
    expect(cameraHeadingDeg(pitched(250, 60, 0), 10)).toBeCloseTo(250, 9);
  });

  it("keeps the last heading at 88 degrees down, rolled a degree either way", () => {
    for (const roll of [-1, 0, 1]) {
      expect(cameraHeadingDeg(pitched(200, 88, roll), 30)).toBe(30);
    }
    // Before any heading: none, never a guess.
    expect(cameraHeadingDeg(pitched(200, 88, 1), null)).toBeNull();
    expect(cameraHeadingDeg(null, 30)).toBe(30);
    expect(cameraHeadingDeg([Number.NaN, 0, 0], 30)).toBe(30);
  });

  it("holds exactly below the share, and the bearing counts at it", () => {
    const at = (share: number) =>
      [share, -Math.sqrt(1 - share ** 2), 0] as const;
    expect(cameraHeadingDeg(at(0.3001), 77, 0.3)).toBeCloseTo(0, 9);
    expect(cameraHeadingDeg(at(0.2999), 77, 0.3)).toBe(77);
  });

  it("property: the heading returned is the forward's bearing or the last one", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 359, noNaN: true })),
        (bearing, pitch, roll, last) => {
          const f = pitched(bearing, pitch, roll);
          const out = cameraHeadingDeg(f, last);
          const held = horizontalShare(f) < WALK_HEADING_MIN_SHARE;
          const own = (Math.atan2(f[2], f[0]) * 180) / Math.PI;
          // Held: the last heading; else the forward's own bearing.
          const offBy = held
            ? out === last
              ? 0
              : Infinity
            : Math.abs(delta(out!, own));
          expect(offBy).toBeLessThan(1e-6);
        },
      ),
    );
  });
});

/**
 * The sweep (shares 0.15-0.45, tremor 0.5-2 degrees of roll): for every
 * pitch from level to straight down in 0.25 degree steps, the heading a
 * tremor of `j` degrees either way reports, against the one it reports
 * held still - the largest swing over all pitches - and the pitch from
 * which the heading is held. The direction words change only past a 5
 * degree hysteresis (`walk-direction.ts`), so a swing under 5 degrees
 * never flips a word.
 */
function sweep(share: number, tremorDeg: number) {
  let worst = 0;
  let heldFrom: number | null = null;
  for (let pitch = 0; pitch <= 90; pitch += 0.25) {
    const still = cameraHeadingDeg(pitched(0, pitch, 0), 0, share);
    if (heldFrom === null && horizontalShare(pitched(0, pitch, 0)) < share) {
      heldFrom = pitch;
    }
    for (const roll of [-tremorDeg, tremorDeg]) {
      const shaken = cameraHeadingDeg(pitched(0, pitch, roll), still, share);
      worst = Math.max(worst, Math.abs(delta(shaken!, still!)));
    }
  }
  return { worst, heldFrom: heldFrom ?? 90 };
}

describe("the horizontal share's sweep", () => {
  const SHARES = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45];
  const TREMORS = [0.5, 1, 2];
  const table = SHARES.map((share) => ({
    share,
    heldFromDeg: sweep(share, 1).heldFrom,
    worst: TREMORS.map((j) => sweep(share, j).worst),
  }));

  it("writes its table to the file WALK_HEADING_SWEEP_OUT names, when set", () => {
    const out = process.env["WALK_HEADING_SWEEP_OUT"];
    if (out !== undefined) {
      writeFileSync(
        out,
        table
          .map(
            (r) =>
              `share ${r.share.toFixed(2)}: held from ${r.heldFromDeg.toFixed(2)} deg down; worst swing at 0.5/1/2 deg tremor ${r.worst.map((w) => w.toFixed(1)).join(" / ")} deg`,
          )
          .join("\n"),
      );
    }
    expect(table).toHaveLength(SHARES.length);
  });

  it("without a share a degree of tremor at 88 degrees down swings the bearing by about 27 degrees", () => {
    // The finding the guard answers (a share of 0: today's 1e-6 limit).
    expect(sweep(1e-9, 1).worst).toBeGreaterThan(26);
  });

  it("the shipped share keeps a degree of tremor under the words' 5 degree hysteresis, and 0.15 does not", () => {
    const shipped = table.find((r) => r.share === WALK_HEADING_MIN_SHARE)!;
    expect(shipped.worst[1]).toBeLessThan(5);
    expect(table[0]!.worst[1]).toBeGreaterThan(5);
    // The price: the heading is held only within about 15 degrees of
    // straight down, where a visitor reads no AR view anyway.
    expect(shipped.heldFromDeg).toBeGreaterThanOrEqual(75);
  });

  it("a larger share always trades a smaller swing for a wider held band", () => {
    for (let i = 1; i < table.length; i += 1) {
      expect(table[i]!.worst[1]).toBeLessThan(table[i - 1]!.worst[1]!);
      expect(table[i]!.heldFromDeg).toBeLessThan(table[i - 1]!.heldFromDeg);
    }
  });
});
