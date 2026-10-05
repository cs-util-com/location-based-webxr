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
  "depth/000001.bin",
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
  it("is everything a visitor never reads: the walk, its unbaked frames and its depth", () => {
    const names = ["tour.json", ...RECORDING];
    expect(
      scanEntryNames(
        names,
        manifest({
          captureSpots: {
            fixes: 9,
            gpsAccuracyMedianM: null,
            captures: [
              {
                image: "images/frame-000002.jpg",
                geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] },
              },
            ],
          },
        }),
        "",
      ),
    ).toEqual([
      "session.json",
      "actions/000001.json",
      "actions/000002.json",
      "images/frame-000001.jpg",
      "depth/000001.bin",
    ]);
  });

  it("is empty for a tour that carries only what visitors read", () => {
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
  ];
  const visible = new Set(["tour.json", "images/frame-000002.jpg"]);

  it("keeps only the visitor's entries, in archive order", () => {
    expect(entriesForVisitor(entries, visible)).toEqual([
      { filename: "tour.json" },
      { filename: "images/frame-000002.jpg" },
    ]);
  });

  it("keeps everything for a tour without tour.json (no read set)", () => {
    expect(entriesForVisitor(entries, null)).toEqual(entries);
  });

  it("stops a visitor's background download only for a tour that carries more than visitors read", () => {
    expect(stopsVisitorDownload("visitor", entries, visible)).toBe(true);
    expect(stopsVisitorDownload("visitor", entries.slice(0, 2), visible)).toBe(
      false,
    );
    expect(stopsVisitorDownload("visitor", entries, null)).toBe(false);
    // The creator's working copy is theirs to cache whole.
    expect(stopsVisitorDownload("creator", entries, visible)).toBe(false);
  });
});
