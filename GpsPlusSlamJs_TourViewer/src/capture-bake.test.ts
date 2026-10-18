import { describe, expect, it } from "vitest";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { withTourContent, worldCaptureSpots } from "./tour-content.js";
import { MATURE_GPS_EXTENT_M } from "gps-plus-slam-app-framework/state/alignment-maturity";
import { tourMediaTypeOfEntry } from "gps-plus-slam-app-framework/ar/tour-media";
import {
  loadActionsFromZip,
  readZipEntries,
} from "gps-plus-slam-app-framework/storage";

import {
  bakeCaptureSpots,
  posesOfCaptureSpots,
  type CaptureBakeSource,
} from "./capture-bake";
import {
  SAMPLE_PHOTOS,
  sampleRecordingBytes,
} from "./test-support/sample-recording";

/**
 * Why these tests matter (scan-pass plan S1, S-D11): the creator's Finish
 * computes the recorded photos' spots ONCE and writes them into tour.json,
 * where every visitor trusts them instead of replaying the walk. So the
 * bake must (a) produce spots the visitor's own reader accepts - a spot it
 * rejects would fail the whole tour open - and (b) decline, never guess,
 * whenever the live join would have declined.
 */

async function sampleSource(
  overrides: Partial<CaptureBakeSource> = {},
): Promise<CaptureBakeSource> {
  const bytes = sampleRecordingBytes();
  const actions = (await loadActionsFromZip(bytes)).map((e) => e.action);
  const entries = (await readZipEntries(bytes))
    .filter((e) => !e.directory)
    .map((e) => ({
      filename: e.filename,
      isImage: tourMediaTypeOfEntry(e.filename)?.kind === "image",
    }));
  return {
    entries,
    loadSessionMeta: () => Promise.resolve({ odomCoordVersion: 5 }),
    loadRecordingActions: () => Promise.resolve(actions),
    ...overrides,
  };
}

describe("bakeCaptureSpots over the real sample recording", () => {
  it("bakes one spot per joinable photo, and the visitor's reader accepts them", async () => {
    const bake = await bakeCaptureSpots(await sampleSource());
    expect(bake.kind).toBe("baked");
    if (bake.kind !== "baked") return;
    // 5 of 6: the fixture's first photo precedes the GPS zero and has no
    // joinable position (the integration test of the live join says why).
    expect(bake.spots.captures).toHaveLength(5);
    expect(bake.spots.fixes).toBeGreaterThan(0);
    // Placed into stations as the Finish does (version 3), the reader
    // takes them, and their world view is where the bake put them.
    const tour = withTourContent(createEmptyTourManifest(), {
      objects: [],
      captureSpots: bake.spots,
    });
    const read = parseTourManifest(JSON.parse(serializeTourManifest(tour)));
    const world = worldCaptureSpots(read)!;
    expect(world.captures.map((c) => c.image)).toEqual(
      bake.spots.captures.map((c) => c.image),
    );
    for (const [i, c] of world.captures.entries()) {
      const baked = bake.spots.captures[i]!.geo;
      expect(c.geo.lat).toBeCloseTo(baked.lat, 8);
      expect(c.geo.lon).toBeCloseTo(baked.lon, 8);
      expect(c.geo.alt).toBeCloseTo(baked.alt, 6);
    }
  });

  it("places each photo through ITS pick, not the end-of-walk alignment", async () => {
    // The sample walk is too short to settle, so its picks all fall back to
    // the last alignment and equal the old join (probed: 0.000 m apart).
    // Declaring every moment settled makes each photo take the alignment
    // of the moment it was taken - which the end-of-walk join cannot match
    // unless the bake ignores the picks.
    const source = await sampleSource();
    const atEnd = await bakeCaptureSpots(source);
    const atCapture = await bakeCaptureSpots(source, {
      extentOf: () => MATURE_GPS_EXTENT_M,
    });
    if (atEnd.kind !== "baked" || atCapture.kind !== "baked") {
      throw new Error("expected two bakes");
    }
    const moved = atCapture.spots.captures.filter((c, i) => {
      const end = atEnd.spots.captures[i]!;
      return c.geo.lat !== end.geo.lat || c.geo.lon !== end.geo.lon;
    });
    expect(moved.length).toBeGreaterThan(0);
  });

  it("names each photo once when the recording captured a file twice", async () => {
    // Why (S1 milestone review #7): tour.json refuses a photo named twice,
    // so a duplicate would make the Finish of that tour throw - on every
    // Finish, since each one bakes again. The later capture wins, as the
    // zip's own file is its last write.
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    const again = actions
      .filter((a) => a.type === "gpsData/add2dImage")
      .at(-1)!;
    const bake = await bakeCaptureSpots({
      ...source,
      loadRecordingActions: () => Promise.resolve([...actions, again]),
    });
    if (bake.kind !== "baked") throw new Error("expected a bake");
    const images = bake.spots.captures.map((c) => c.image);
    expect(new Set(images).size).toBe(images.length);
    expect(() =>
      parseTourManifest(
        JSON.parse(
          serializeTourManifest(
            withTourContent(createEmptyTourManifest(), {
              objects: [],
              captureSpots: bake.spots,
            }),
          ),
        ),
      ),
    ).not.toThrow();
  });

  it("drops a photo whose file the zip does not carry, as the live join's decode would", async () => {
    const source = await sampleSource();
    const full = await bakeCaptureSpots(source);
    if (full.kind !== "baked") throw new Error("expected a bake");
    const missing = full.spots.captures[0]!.image;
    const bake = await bakeCaptureSpots({
      ...source,
      entries: source.entries.filter((e) => e.filename !== missing),
    });
    expect(
      bake.kind === "baked" ? bake.spots.captures.map((c) => c.image) : null,
    ).toEqual(full.spots.captures.slice(1).map((c) => c.image));
  });

  it("declines when no photo file is left: the marker must never stop the join for nothing", async () => {
    const source = await sampleSource();
    const bake = await bakeCaptureSpots({
      ...source,
      entries: source.entries.filter((e) => !e.isImage),
    });
    // The walk then places nothing (the M4b milestone review #3): a lean
    // Finish may leave it out, and the editor may move it out.
    expect(bake).toEqual({
      kind: "declined",
      reason: "no recorded photo file in this tour",
      placesNothing: true,
    });
  });

  it("places nothing for a walk on which no photo was taken, whatever its GPS came to", async () => {
    // Why (the M4b milestone review #3): a walk recorded without photos
    // was kept in every lean Finish and could never be moved out of the
    // editor's tour, though it places nothing for any visitor.
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    const without = actions.filter((a) => a.type !== "gpsData/add2dImage");
    // The filter took something away: a no-op would prove nothing.
    expect(without.length).toBeLessThan(actions.length);
    const noFixes = without.filter((a) => a.type !== "gpsData/recordGpsEvent");
    expect(noFixes.length).toBeLessThan(without.length);
    // GPS that solves, and GPS with no fix at all: no photo either way.
    for (const loaded of [without, noFixes]) {
      const bake = await bakeCaptureSpots({
        ...source,
        loadRecordingActions: () => Promise.resolve(loaded),
      });
      expect(bake).toEqual({
        kind: "declined",
        reason: "the recording contains no captured photos",
        placesNothing: true,
      });
    }
  });

  it("does not count a photo file the recording never placed: a walk whose only photo in the tour predates its GPS zero places nothing", async () => {
    // The fixture's first photo precedes the GPS zero, so the recording
    // never gives it a spot (`odometryPath` does not carry it), live or
    // baked: with only its file in the tour, the walk places nothing.
    const source = await sampleSource();
    const full = await bakeCaptureSpots(source);
    if (full.kind !== "baked") throw new Error("expected a bake");
    const unplaced = SAMPLE_PHOTOS.filter(
      (name) => !full.spots.captures.some((c) => c.image === name),
    );
    expect(unplaced).toHaveLength(1);
    const bake = await bakeCaptureSpots({
      ...source,
      entries: source.entries.filter(
        (e) => !e.isImage || unplaced.includes(e.filename),
      ),
    });
    expect(bake).toEqual({
      kind: "declined",
      reason: "no recorded photo file in this tour",
      placesNothing: true,
    });
  });
});

describe("bakeCaptureSpots declines where the live join declines", () => {
  it("a tour without a recording", async () => {
    const bake = await bakeCaptureSpots({
      entries: [],
      loadSessionMeta: () => Promise.resolve(null),
      loadRecordingActions: () => Promise.resolve(null),
    });
    expect(bake).toEqual({
      kind: "declined",
      reason: "no recording in this tour",
    });
  });

  it("a recording of an era this viewer does not replay", async () => {
    const bake = await bakeCaptureSpots(
      await sampleSource({
        loadSessionMeta: () => Promise.resolve({ odomCoordVersion: 3 }),
      }),
    );
    expect(bake.kind).toBe("declined");
  });

  it("a replay the caller stopped", async () => {
    const bake = await bakeCaptureSpots(await sampleSource(), {
      shouldContinue: () => false,
    });
    expect(bake).toEqual({ kind: "declined", reason: "stopped" });
  });
});

describe("posesOfCaptureSpots", () => {
  // Why: the viewer places baked spots through the same decode-and-plant
  // path as the live join's poses; the altitude field changes name on the
  // way (`alt` in the file, `altitude` in the join), so a mix-up would put
  // every photo at sea level.
  it("turns each baked spot into the join's pose, altitude and rotation included", () => {
    expect(
      posesOfCaptureSpots({
        fixes: 9,
        gpsAccuracyMedianM: null,
        captures: [
          {
            image: "images/a.jpg",
            geo: { lat: 48.1, lon: 11.5, alt: 520.5, rotation: [0, 1, 0, 0] },
          },
        ],
      }),
    ).toEqual([
      {
        imageFile: "images/a.jpg",
        geo: { lat: 48.1, lon: 11.5, altitude: 520.5 },
        rotationNue: [0, 1, 0, 0],
      },
    ]);
  });

  it("leaves out a spot without a rotation rather than guessing one", () => {
    expect(
      posesOfCaptureSpots({
        fixes: 9,
        gpsAccuracyMedianM: 1,
        captures: [
          {
            image: "images/a.jpg",
            geo: { lat: 48, lon: 11, alt: 0, headingDeg: 0 },
          },
        ],
      }),
    ).toEqual([]);
  });
});
