import { describe, expect, it } from "vitest";
import {
  createEmptyTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  entriesForVisitor,
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

const photo = {
  id: "f1",
  kind: "photo" as const,
  geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] as const },
  createdAtIso: "2026-10-05T10:00:00.000Z",
  image: "content/f1.jpg",
  imageWidth: 4,
  imageHeight: 3,
};

function manifest(extra: Partial<TourManifest> = {}): TourManifest {
  return { ...createEmptyTourManifest(), ...extra };
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
        captureSpots: {
          fixes: 9,
          gpsAccuracyMedianM: 3,
          captures: [
            {
              image: "images/frame-000002.jpg",
              geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] },
            },
          ],
        },
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
  const spot = {
    image: "images/frame-000002.jpg",
    geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] as const },
  };

  it("is the recording's own files a visitor never reads: the walk and its unbaked frames", () => {
    const names = ["tour.json", ...RECORDING, "frames/frame-000009.jpg"];
    expect(
      scanEntryNames(
        names,
        manifest({
          captureSpots: {
            fixes: 9,
            gpsAccuracyMedianM: null,
            captures: [spot],
          },
        }),
        "",
      ),
    ).toEqual([
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
        manifest({
          captureSpots: {
            fixes: 9,
            gpsAccuracyMedianM: null,
            captures: [spot],
          },
        }),
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
        manifest({
          captureSpots: {
            fixes: 9,
            gpsAccuracyMedianM: null,
            captures: [spot],
          },
        }),
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

  it("stops a visitor's background download only for a copy that carries a walk", () => {
    expect(stopsVisitorDownload("visitor", scan)).toBe(true);
    expect(stopsVisitorDownload("visitor", new Set())).toBe(false);
    // The creator's working copy is theirs to cache whole.
    expect(stopsVisitorDownload("creator", scan)).toBe(false);
  });
});
