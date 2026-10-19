import { describe, expect, it } from "vitest";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { tourOf } from "./test-support/v3-tour.js";

import {
  entriesForVisitor,
  recordingEntryNames,
  scanEntryNames,
  stopsVisitorDownload,
  visitorEntryNames,
} from "./tour-read-set";

/**
 * Why these tests matter (scan-pass plan S1, S-D10): the read set is what
 * the published copy keeps and what a visitor may read. An entry missing
 * from it is content a visitor never sees after Publish - a broken tour
 * nobody notices until the field. An entry wrongly in it is the creator's
 * walk shipped to every visitor.
 */

const GEO = { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] } as const;

const photo: TourObject = {
  id: "f1",
  kind: "photo",
  geo: GEO,
  createdAtIso: "2026-10-05T10:00:00.000Z",
  image: "content/f1.jpg",
  imageWidth: 4,
  imageHeight: 3,
};

/** A version 3 tour: each of `objects` in a station of its own. */
function manifest(
  extra: Partial<TourManifest> & { objects?: readonly TourObject[] } = {},
): TourManifest {
  const { objects = [], ...rest } = extra;
  return tourOf(objects, rest);
}

/** A walk's baked photos, in a station of their own (version 3). */
function walk(
  images: readonly string[],
  gpsAccuracyMedianM: number | null,
): Partial<TourManifest> {
  return {
    stations: [
      {
        id: "walk",
        geo: GEO,
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        steps: [],
        items: [],
      },
    ],
    captureSpots: {
      fixes: 9,
      gpsAccuracyMedianM,
      captures: images.map((image) => ({
        image,
        station: "walk",
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      })),
    },
  };
}

const RECORDING = [
  "session.json",
  "actions/000001.json",
  "actions/000002.json",
  "images/frame-000001.jpg",
  "images/frame-000002.jpg",
];

describe("visitorEntryNames", () => {
  it("keeps the manifest, every code level, the signed list and the content the manifest names", () => {
    const names = [
      "tour.json",
      "qr/abc123.json",
      "manifest.json",
      "manifest.sig.json",
      "content/f1.jpg",
      "content/knight.png",
      ...RECORDING,
    ];
    const read = visitorEntryNames(
      names,
      manifest({
        objects: [photo],
        assets: [{ id: "knight", path: "content/knight.png" } as never],
        ...walk(["images/frame-000002.jpg"], 3),
      }),
      "",
    );
    expect([...read].sort()).toEqual(
      [
        "content/f1.jpg",
        "content/knight.png",
        "images/frame-000002.jpg",
        "manifest.json",
        "manifest.sig.json",
        "qr/abc123.json",
        "tour.json",
      ].sort(),
    );
  });

  it("without baked spots keeps every image, so the photo ring still has its photos", () => {
    const read = visitorEntryNames(["tour.json", ...RECORDING], manifest(), "");
    expect([...read].sort()).toEqual(
      [
        "images/frame-000001.jpg",
        "images/frame-000002.jpg",
        "tour.json",
      ].sort(),
    );
  });

  it("joins a wrapped tour's folder onto the names the manifest carries", () => {
    const read = visitorEntryNames(
      ["mytour/tour.json", "mytour/qr/abc123.json", "mytour/content/f1.jpg"],
      manifest({ objects: [photo] }),
      "mytour/",
    );
    expect(read).toEqual(
      new Set([
        "mytour/tour.json",
        "mytour/qr/abc123.json",
        "mytour/content/f1.jpg",
      ]),
    );
  });

  it("names only entries the archive has", () => {
    // A manifest naming a file the zip lacks must not make the published
    // copy claim it: the set is a filter over the archive.
    const read = visitorEntryNames(
      ["tour.json"],
      manifest({ objects: [photo] }),
      "",
    );
    expect(read).toEqual(new Set(["tour.json"]));
  });
});

describe("scanEntryNames", () => {
  // The walk is defined by what a RECORDING writes (session.json,
  // actions/, images/ or legacy frames/ frame-NNNNNN files), not as
  // "everything a visitor does not read": a creator's README, credits or
  // licence file is never the walk, and dropping it from the published copy
  // would lose it silently (the first milestone browser run caught exactly
  // that).
  const baked = walk(["images/frame-000002.jpg"], null);

  it("is the recording's own files a visitor never reads: the walk and its unbaked frames", () => {
    const names = ["tour.json", ...RECORDING, "frames/frame-000009.jpg"];
    expect(scanEntryNames(names, manifest(baked), "")).toEqual([
      "session.json",
      "actions/000001.json",
      "actions/000002.json",
      "images/frame-000001.jpg",
      "frames/frame-000009.jpg",
    ]);
  });

  it("never names a file the recording did not write", () => {
    expect(
      scanEntryNames(
        [
          "tour.json",
          "README.txt",
          "credits/LICENSE.md",
          "data.json",
          "depth/000001.bin",
          "images/poster.jpg",
        ],
        manifest(baked),
        "",
      ),
    ).toEqual([]);
  });

  it("keeps a recording's frames for a tour without baked spots: the ring shows them", () => {
    expect(scanEntryNames(["tour.json", ...RECORDING], manifest(), "")).toEqual(
      ["session.json", "actions/000001.json", "actions/000002.json"],
    );
  });

  it("is empty without an action stream, whatever else looks like a recording", () => {
    // The e2e tour fixture carries a session.json of its own and no
    // actions; the second milestone browser run caught a version that
    // dropped it. Without a walk there is nothing of the walk to drop.
    expect(
      scanEntryNames(
        ["tour.json", "session.json", "images/frame-000001.jpg"],
        manifest(baked),
        "",
      ),
    ).toEqual([]);
  });

  it("is empty for a tour that carries no recording", () => {
    expect(
      scanEntryNames(["tour.json", "qr/abc123.json"], manifest(), ""),
    ).toEqual([]);
  });
});

describe("recordingEntryNames", () => {
  // Why (the M4b milestone review #8): the editor's "Move the walk out"
  // puts the walk into a file of its own, and that file must be the whole
  // recording - also the frames a baked tour keeps for its visitors, which
  // `scanEntryNames` rightly leaves in the tour. Without them the moved-out
  // walk is a recording with photos missing.
  it("is every entry the recording wrote, the frames a visitor sees included, in archive order", () => {
    expect(
      recordingEntryNames([
        "tour.json",
        ...RECORDING,
        "README.txt",
        "sparse/0/points3D.txt",
        "refPoints/a.json",
        "content/f1.jpg",
      ]),
    ).toEqual([...RECORDING, "sparse/0/points3D.txt", "refPoints/a.json"]);
  });

  it("is empty without an action stream", () => {
    expect(
      recordingEntryNames([
        "tour.json",
        "session.json",
        "images/frame-000001.jpg",
      ]),
    ).toEqual([]);
  });

  it("holds every entry scanEntryNames names, for any manifest", () => {
    const names = ["tour.json", ...RECORDING, "frames/frame-000009.jpg"];
    const all = recordingEntryNames(names);
    for (const m of [manifest(), manifest({ objects: [photo] })]) {
      for (const name of scanEntryNames(names, m, "")) {
        expect(all).toContain(name);
      }
    }
  });
});

describe("what a visitor's page shows and downloads", () => {
  // Why: the gallery, the photo ring and the background download used to
  // read every entry. For a copy that kept the walk (S-D10, for a
  // co-author) that is the creator's frames on every visitor's screen and
  // the whole walk on every visitor's data plan (cold review R1).
  const entries = [
    { filename: "tour.json" },
    { filename: "images/frame-000002.jpg" },
    { filename: "images/frame-000001.jpg" },
    { filename: "actions/000001.json" },
    { filename: "README.txt" },
  ];
  const scan = new Set(["images/frame-000001.jpg", "actions/000001.json"]);

  it("leaves out the walk, in archive order, and keeps everything else", () => {
    expect(entriesForVisitor(entries, scan)).toEqual([
      { filename: "tour.json" },
      { filename: "images/frame-000002.jpg" },
      { filename: "README.txt" },
    ]);
  });

  it("stops a visitor's background download only for a baked copy that carries a walk", () => {
    expect(stopsVisitorDownload("visitor", scan, true)).toBe(true);
    expect(stopsVisitorDownload("visitor", new Set(), true)).toBe(false);
    // The creator's working copy is theirs to cache whole.
    expect(stopsVisitorDownload("creator", scan, true)).toBe(false);
    // Without baked spots the viewer replays the walk, by range reads of
    // every action entry: stopping the download would only make it slower
    // and lose the offline copy (S1 milestone review #1).
    expect(stopsVisitorDownload("visitor", scan, false)).toBe(false);
  });
});
