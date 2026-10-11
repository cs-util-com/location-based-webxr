/**
 * Why these tests matter (code book plan, M6 v5.1): a code's automatic-move
 * memory (the spot it moved from, its second prints) must survive a Finish,
 * a reload, another device and every re-mint, or an undo restores nothing
 * and a second print moves the code again. It lives in the level file as
 * `qr.spots`, which visitors' parser ignores, so it is read LENIENTLY here:
 * a damaged entry is dropped, never a reason to reject the level (M6 v2
 * review #9).
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import { MAX_CODE_COPIES } from "./code-spots";
import {
  carryCodeSpots,
  readCodeSpots,
  writeCodeSpots,
  type StoredSpot,
} from "./level-spots";

const geo = (lat: number, headingDeg = 90) => ({
  lat,
  lon: 11.5,
  alt: 520,
  headingDeg,
});
const level = (qr: Record<string, unknown>) =>
  JSON.stringify({ version: 1, qr: { physicalSizeM: 0.2, ...qr } });

const T: StoredSpot = {
  geo: geo(48.1),
  mintQuality: { gpsAccuracyM: 4, mintedAtIso: "2026-10-01T10:00:00.000Z" },
};
const N: StoredSpot = { geo: geo(48.1003), mintQuality: { gpsAccuracyM: 6 } };
const Q: StoredSpot = { geo: geo(48.1006, 180) };

describe("readCodeSpots", () => {
  it("reads a level from an older build as its current spot alone", () => {
    expect(
      readCodeSpots(level({ geo: T.geo, mintQuality: T.mintQuality })),
    ).toEqual({ current: T, previous: null, copies: [] });
  });

  it("reads the remembered spots", () => {
    const json = level({
      geo: N.geo,
      mintQuality: N.mintQuality,
      spots: { previous: T, copies: [Q] },
    });
    expect(readCodeSpots(json)).toEqual({
      current: N,
      previous: T,
      copies: [Q],
    });
  });

  it("drops a damaged entry and keeps the rest", () => {
    const json = level({
      geo: N.geo,
      spots: {
        previous: { geo: { lat: 200 } },
        copies: [Q, "x", { geo: geo(48.2), mintQuality: { gpsAccuracyM: -1 } }],
      },
    });
    expect(readCodeSpots(json)).toEqual({
      current: { geo: N.geo },
      previous: null,
      // A copy with a broken quality keeps its pose: the pose is what
      // recognises the print.
      copies: [Q, { geo: geo(48.2) }],
    });
  });

  // Why (M6 milestone review #8): the level file is external data, and
  // every sighting is fitted against every known spot.
  it("keeps only the newest MAX_CODE_COPIES copies of a long list", () => {
    const many = Array.from({ length: MAX_CODE_COPIES + 3 }, (_, i) => ({
      geo: geo(48 + i / 1000),
    }));
    const read = readCodeSpots(level({ geo: N.geo, spots: { copies: many } }));
    expect(read?.copies).toEqual(many.slice(-MAX_CODE_COPIES));
  });

  it("ignores a spots field of the wrong shape", () => {
    for (const spots of [null, 3, "x", [], { copies: 5 }])
      expect(readCodeSpots(level({ geo: N.geo, spots }))?.copies).toEqual([]);
  });

  it("returns null for a level without a saved pose, or an unreadable one", () => {
    expect(readCodeSpots(level({}))).toBeNull();
    expect(readCodeSpots("{")).toBeNull();
  });
});

describe("writeCodeSpots", () => {
  it("writes the current spot as the level's pose and the rest as qr.spots", () => {
    const json = writeCodeSpots(level({ geo: N.geo }), {
      current: T,
      previous: N,
      copies: [Q],
    });
    expect(readCodeSpots(json)).toEqual({
      current: T,
      previous: N,
      copies: [Q],
    });
    // Visitors' parser still reads it, and sees only the current pose.
    const parsed = parseQrLevel(JSON.parse(json) as unknown);
    expect(parsed.qr.geo).toEqual(T.geo);
    expect(parsed.qr.physicalSizeM).toBe(0.2);
  });

  it("writes no spots field when there is nothing to remember", () => {
    const json = writeCodeSpots(level({ geo: N.geo, spots: { copies: [Q] } }), {
      current: N,
      previous: null,
      copies: [],
    });
    expect((JSON.parse(json) as { qr: object }).qr).not.toHaveProperty("spots");
  });

  it("drops a current quality the new spot does not have", () => {
    const json = writeCodeSpots(
      level({ geo: T.geo, mintQuality: T.mintQuality }),
      { current: Q, previous: null, copies: [] },
    );
    expect(readCodeSpots(json)?.current).toEqual(Q);
  });
});

describe("carryCodeSpots - the one seam every re-mint goes through", () => {
  it("keeps the old level's memory on the freshly minted text", () => {
    const old = level({ geo: N.geo, spots: { previous: T, copies: [Q] } });
    const fresh = level({ geo: geo(48.10031), mintQuality: N.mintQuality });
    expect(readCodeSpots(carryCodeSpots(old, fresh))).toEqual({
      current: { geo: geo(48.10031), mintQuality: N.mintQuality },
      previous: T,
      copies: [Q],
    });
  });

  it("returns the fresh text unchanged when the old one remembered nothing", () => {
    const fresh = level({ geo: N.geo });
    expect(carryCodeSpots(level({ geo: T.geo }), fresh)).toBe(fresh);
    expect(carryCodeSpots("{", fresh)).toBe(fresh);
  });
});

// Why (M6 milestone review #10): the framework's `serializeQrLevel` goes
// through its parser, which drops `qr.spots`. A stored level re-serialised
// through it would lose the code's memory without a word; today only the
// framework's own mint (a fresh level) uses it, and the carry runs after.
describe("no stored level is re-serialised through the framework parser", () => {
  it("serializeQrLevel appears in no Tour Viewer source file", () => {
    const dir = new URL(".", import.meta.url);
    const users = readdirSync(dir).filter(
      (name) =>
        name.endsWith(".ts") &&
        !name.includes(".test.") &&
        readFileSync(new URL(name, dir), "utf8").includes("serializeQrLevel"),
    );
    expect(users).toEqual([]);
  });
});
