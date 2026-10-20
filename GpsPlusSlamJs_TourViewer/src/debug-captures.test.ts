import { describe, expect, it } from "vitest";
import { MATURE_GPS_EXTENT_M } from "gps-plus-slam-app-framework/state/alignment-maturity";
import { tourMediaTypeOfEntry } from "gps-plus-slam-app-framework/ar/tour-media";
import {
  loadActionsFromZip,
  readZipEntries,
} from "gps-plus-slam-app-framework/storage";

import { debugCapturesOf, type DebugCaptureSource } from "./debug-captures";
import {
  SAMPLE_PHOTOS,
  sampleRecordingBytes,
} from "./test-support/sample-recording";

/**
 * Why these tests matter: the desktop editor's debug layer draws the
 * walk's camera captures where this join places them, and says why when
 * it places none. So it must (a) place one capture per file the tour
 * carries, each through its own alignment pick, and (b) decline, never
 * guess, whenever the join (`capture-geo-join.ts`) declines - with a
 * reason the layer's line can show. (These tests began as the bake's,
 * which wrote the places into tour.json; that half, and the visitor's
 * reader of it, went when the captures became debug data.)
 */

async function sampleSource(
  overrides: Partial<DebugCaptureSource> = {},
): Promise<DebugCaptureSource> {
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

describe("debugCapturesOf over the real sample recording", () => {
  it("places one capture per joinable frame, each at a usable geo pose", async () => {
    const read = await debugCapturesOf(await sampleSource());
    expect(read.kind).toBe("placed");
    if (read.kind !== "placed") return;
    // 5 of 6: the fixture's first photo precedes the GPS zero and has no
    // joinable position (`capture-geo-join.integration.test.ts` says why).
    expect(read.captures.captures).toHaveLength(5);
    expect(read.captures.fixes).toBeGreaterThan(0);
    // (Here the places were written into tour.json and read back by the
    // visitor's reader; nothing writes them now. What the layer needs is
    // a finite place for each, and a picture the tour carries.)
    for (const c of read.captures.captures) {
      expect(SAMPLE_PHOTOS).toContain(c.image);
      expect(Number.isFinite(c.geo.lat)).toBe(true);
      expect(Number.isFinite(c.geo.lon)).toBe(true);
      expect(Number.isFinite(c.geo.alt)).toBe(true);
    }
  });

  it("places each photo through ITS pick, not the end-of-walk alignment", async () => {
    // The sample walk is too short to settle, so its picks all fall back to
    // the last alignment and equal the old join (probed: 0.000 m apart).
    // Declaring every moment settled makes each photo take the alignment
    // of the moment it was taken - which the end-of-walk join cannot match
    // unless the join ignores the picks.
    const source = await sampleSource();
    const atEnd = await debugCapturesOf(source);
    const atCapture = await debugCapturesOf(source, {
      extentOf: () => MATURE_GPS_EXTENT_M,
    });
    if (atEnd.kind !== "placed" || atCapture.kind !== "placed") {
      throw new Error("expected two placements");
    }
    const moved = atCapture.captures.captures.filter((c, i) => {
      const end = atEnd.captures.captures[i]!;
      return c.geo.lat !== end.geo.lat || c.geo.lon !== end.geo.lon;
    });
    expect(moved.length).toBeGreaterThan(0);
  });

  it("names each capture once when the recording captured a file twice", async () => {
    // Why (S1 milestone review #7): one file has one picture, so the layer
    // draws one marker per file. The later capture wins, as the zip's own
    // file is its last write. (It also kept tour.json readable while the
    // places were written into it; that check went with the writing.)
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    const again = actions
      .filter((a) => a.type === "gpsData/add2dImage")
      .at(-1)!;
    const read = await debugCapturesOf({
      ...source,
      loadRecordingActions: () => Promise.resolve([...actions, again]),
    });
    if (read.kind !== "placed") throw new Error("expected a placement");
    const images = read.captures.captures.map((c) => c.image);
    expect(new Set(images).size).toBe(images.length);
    expect(images).toContain(
      (again.payload as { imageFile: string }).imageFile,
    );
  });

  it("drops a capture whose file the zip does not carry: a marker naming no file would show nothing", async () => {
    const source = await sampleSource();
    const full = await debugCapturesOf(source);
    if (full.kind !== "placed") throw new Error("expected a placement");
    const missing = full.captures.captures[0]!.image;
    const read = await debugCapturesOf({
      ...source,
      entries: source.entries.filter((e) => e.filename !== missing),
    });
    expect(
      read.kind === "placed"
        ? read.captures.captures.map((c) => c.image)
        : null,
    ).toEqual(full.captures.captures.slice(1).map((c) => c.image));
  });

  it("declines when no capture file is left, and says so", async () => {
    const source = await sampleSource();
    const read = await debugCapturesOf({
      ...source,
      entries: source.entries.filter((e) => !e.isImage),
    });
    // (It also said "places nothing", which let a lean Finish drop the
    // walk for good; nothing reads that now, so the decline is its reason
    // alone, worded for the debug layer's line.)
    expect(read).toEqual({
      kind: "declined",
      reason: "no camera capture file in this tour",
    });
  });

  it("says the recording contains no captures for a walk on which none was taken, whatever its GPS came to", async () => {
    // Why: a walk recorded without camera captures shows none; the line
    // must not say they could not be placed (or blame the GPS).
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    const without = actions.filter((a) => a.type !== "gpsData/add2dImage");
    // The filter took something away: a no-op would prove nothing.
    expect(without.length).toBeLessThan(actions.length);
    const noFixes = without.filter((a) => a.type !== "gpsData/recordGpsEvent");
    expect(noFixes.length).toBeLessThan(without.length);
    // GPS that solves, and GPS with no fix at all: no photo either way.
    for (const loaded of [without, noFixes]) {
      const read = await debugCapturesOf({
        ...source,
        loadRecordingActions: () => Promise.resolve(loaded),
      });
      // (Was "...no captured photos" with "places nothing"; see above.)
      expect(read).toEqual({
        kind: "declined",
        reason: "the recording contains no camera captures",
      });
    }
  });

  it("does not count a capture file the recording never placed: a walk whose only file in the tour predates its GPS zero shows none", async () => {
    // The fixture's first photo precedes the GPS zero, so the recording
    // never gives it a place (`odometryPath` does not carry it): with
    // only its file in the tour, the walk shows no capture.
    const source = await sampleSource();
    const full = await debugCapturesOf(source);
    if (full.kind !== "placed") throw new Error("expected a placement");
    const unplaced = SAMPLE_PHOTOS.filter(
      (name) => !full.captures.captures.some((c) => c.image === name),
    );
    expect(unplaced).toHaveLength(1);
    const read = await debugCapturesOf({
      ...source,
      entries: source.entries.filter(
        (e) => !e.isImage || unplaced.includes(e.filename),
      ),
    });
    // (Was "no recorded photo file" with "places nothing"; see above.)
    expect(read).toEqual({
      kind: "declined",
      reason: "no camera capture file in this tour",
    });
  });
});

describe("debugCapturesOf over a recording wrapped in a folder", () => {
  it("finds every capture's file under the folder the recording sits in, and names its entry", async () => {
    // Why this test matters: a tour re-zipped from its folder ("compress
    // this folder") puts every entry under `mytour/`, while a capture's
    // `imageFile` stays relative to the recording (`images/frame-...`).
    // Matched by exact name, no capture of such a tour named a file, so
    // the debug layer showed none and said the tour carried no capture
    // file. The layer reads a picture by its entry name, so each capture
    // must name the wrapped entry.
    const flat = await sampleSource();
    const wrapped: DebugCaptureSource = {
      ...flat,
      entries: flat.entries.map((e) => ({
        ...e,
        filename: `mytour/${e.filename}`,
      })),
    };
    const fromFlat = await debugCapturesOf(flat);
    const read = await debugCapturesOf(wrapped);
    if (fromFlat.kind !== "placed") throw new Error("expected a placement");
    expect(read).toEqual({
      kind: "placed",
      captures: {
        ...fromFlat.captures,
        captures: fromFlat.captures.captures.map((c) => ({
          ...c,
          image: `mytour/${c.image}`,
        })),
      },
    });
  });

  it("never takes a file of another folder for a capture's", async () => {
    // Why: only the recording's own folder holds its frames. A frame of
    // the same name elsewhere in the zip (a second recording, a copy) is
    // not this walk's capture, so a recording at the root whose frames
    // are all under another folder names none.
    const flat = await sampleSource();
    const elsewhere: DebugCaptureSource = {
      ...flat,
      entries: flat.entries.map((e) =>
        e.isImage ? { ...e, filename: `copy/${e.filename}` } : e,
      ),
    };
    expect(await debugCapturesOf(elsewhere)).toEqual({
      kind: "declined",
      reason: "no camera capture file in this tour",
    });
  });
});

describe("debugCapturesOf says why a walk it cannot read shows no capture", () => {
  // Why: "the recording contains no camera captures" is a claim about the
  // walk. Only a recording of a known era that really took none may make
  // it. A replay that turns the recording's captures into no place at all
  // - a newer recording era this build cannot read, or capture actions it
  // could not place - says none could be placed. (These pinned that such
  // a walk was not "placing nothing", which let a lean Finish drop it for
  // good; the reason is now what tells them apart.)
  it("says none could be placed for a newer-era recording that shows this build none", async () => {
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    // A newer era may name its photo actions differently: this build sees
    // none of them.
    const renamed = actions.map((a) =>
      a.type === "gpsData/add2dImage"
        ? { ...a, type: "gpsData/addPhotoV6" }
        : a,
    );
    const read = await debugCapturesOf({
      ...source,
      loadSessionMeta: () => Promise.resolve({ odomCoordVersion: 6 }),
      loadRecordingActions: () => Promise.resolve(renamed),
    });
    expect(read).toEqual({
      kind: "declined",
      reason: "none of the camera captures could be placed",
    });
  });

  it("says none could be placed when the recording took captures the replay placed none of", async () => {
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    // Every photo before the GPS zero: the replay gives none a spot.
    const photos = actions.filter((a) => a.type === "gpsData/add2dImage");
    const rest = actions.filter((a) => a.type !== "gpsData/add2dImage");
    expect(photos.length).toBeGreaterThan(0);
    const read = await debugCapturesOf({
      ...source,
      loadRecordingActions: () => Promise.resolve([...photos, ...rest]),
    });
    expect(read).toEqual({
      kind: "declined",
      reason: "none of the camera captures could be placed",
    });
  });
});

describe("debugCapturesOf declines where the join declines", () => {
  it("a tour without a recording", async () => {
    const read = await debugCapturesOf({
      entries: [],
      loadSessionMeta: () => Promise.resolve(null),
      loadRecordingActions: () => Promise.resolve(null),
    });
    expect(read).toEqual({
      kind: "declined",
      reason: "no recording in this tour",
    });
  });

  it("a recording of an era this viewer does not replay", async () => {
    const read = await debugCapturesOf(
      await sampleSource({
        loadSessionMeta: () => Promise.resolve({ odomCoordVersion: 3 }),
      }),
    );
    expect(read.kind).toBe("declined");
  });

  // Why (PR #640 review): only a recording of a KNOWN era may say it took
  // no capture. A session.json is hand-editable: an absent version, or a
  // string one ("3" <= 5 is true in JavaScript), must decline, never read
  // as known. The guard that catches them today is the preflight, BEFORE
  // the replay (its reason is asserted, M5c review #5); the narrowing in
  // the "contains none" branch keeps that branch safe on its own and
  // satisfies the type checker, and is not reached by these inputs.
  it.each([
    ["absent", {}],
    ["a string", { odomCoordVersion: "3" }],
    ["a numeric string of the current era", { odomCoordVersion: "5" }],
  ])("a recording whose era is %s declines", async (_label, meta) => {
    const source = await sampleSource();
    const actions = (await source.loadRecordingActions())!;
    // No capture this build recognises: the "contains none" branch.
    const renamed = actions.map((a) =>
      a.type === "gpsData/add2dImage"
        ? { ...a, type: "gpsData/addPhotoV6" }
        : a,
    );
    const read = await debugCapturesOf({
      ...source,
      loadSessionMeta: () => Promise.resolve(meta),
      loadRecordingActions: () => Promise.resolve(renamed),
    });
    expect(read).toEqual({
      kind: "declined",
      reason: "the recording predates the current format (no migration here)",
    });
  });

  it("reports the replay's progress to its caller, rising to the whole walk (and declines nothing for it)", async () => {
    // Why (the r900 PR review): the layer's progress line is only as good
    // as these calls - the same total each time, rising, ending complete.
    const calls: [number, number][] = [];
    const read = await debugCapturesOf(await sampleSource(), {
      onChunk: (done, total) => {
        calls.push([done, total]);
      },
    });
    expect(read.kind).toBe("placed");
    expect(calls.length).toBeGreaterThan(0);
    const total = calls[0]![1];
    expect(total).toBeGreaterThan(0);
    expect(calls.every(([, t]) => t === total)).toBe(true);
    const done = calls.map(([d]) => d);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(calls.at(-1)).toEqual([total, total]);
  });

  it("a replay the caller stopped", async () => {
    const read = await debugCapturesOf(await sampleSource(), {
      shouldContinue: () => false,
    });
    expect(read).toEqual({ kind: "declined", reason: "stopped" });
  });
});
