/**
 * Why these tests matter: a version 3 tour (tour editor plan
 * 2026-10-17-1816, W3) has no loose pins: every pin and photo the creator
 * saves must land in a station, at a local pose, by the
 * automatic-station rule (D20, D21). The Tour Viewer edits a world view
 * (each object with its geo pose) and writes through `withTourContent`, so
 * these tests pin the write: an object nobody moved keeps its local pose
 * bit for bit (D17's "never changes a child's local pose" starts here), a
 * moved one is re-expressed in its own station, every object goes into the
 * station it names (the writer starts none), a file's debug camera
 * captures leave the tour with the stations only they kept
 * (`withoutDebugCaptures`), and a saved object compares equal to its
 * stored copy (`asStored`), which is what keeps a draft from being
 * offered back after its save.
 */

import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type {
  TourAsset,
  TourBlock,
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { objectContentKey } from "./authoring-draft.js";
import {
  asStored,
  withoutDebugCaptures,
  withReferencedAssets,
  withTourContent,
} from "./tour-content.js";

// The core's geodesy runs only under an activated licence.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const M_PER_DEG = 111_320;
const LAT = 48.1;
const LON = 11.5;

/** A geo pose `n` metres north and `e` metres east of the origin. */
function geo(n: number, e: number, alt = 520, yawDeg = 0) {
  const half = (-yawDeg * Math.PI) / 360;
  return {
    lat: LAT + n / M_PER_DEG,
    lon: LON + e / (M_PER_DEG * Math.cos((LAT * Math.PI) / 180)),
    alt,
    rotation: [0, Math.sin(half), 0, Math.cos(half)] as [
      number,
      number,
      number,
      number,
    ],
  };
}

function station(id: string, n: number, e: number): TourStation {
  return {
    id,
    geo: geo(n, e, 520, 30),
    activateRadiusM: 40,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [],
    items: [],
  };
}

function pin(id: string, n: number, e: number, label = id): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-18T06:00:00.000Z",
    geo: geo(n, e, 521.5),
  };
}

function tour(stations: TourStation[]): TourManifest {
  return { version: 3, minor: 0, order: "fixed", assets: [], stations };
}

/** `object` naming the station `id`, as the tour document seats it. */
function inStation(object: TourObject, id: string): TourObject {
  return { ...object, station: id };
}

describe("withTourContent", () => {
  it("an object nobody moved keeps its local pose bit for bit, its station, and its order", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [
        inStation(pin("a", 3, 4), "gate"),
        inStation(pin("b", -2, 1), "gate"),
      ],
    });
    const again = withTourContent(base, { objects: tourObjects(base) });
    expect(JSON.stringify(again.stations)).toBe(JSON.stringify(base.stations));
  });

  it("an edited label keeps the pose; a moved object is re-expressed in its own station", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [
        inStation(pin("a", 3, 4), "gate"),
        inStation(pin("b", -2, 1), "gate"),
      ],
    });
    const [a, b] = tourObjects(base);
    const moved = { ...b!, geo: geo(5, 5, 521.5) };
    const next = withTourContent(base, {
      objects: [{ ...a!, label: "renamed" }, moved],
    });
    const items = next.stations[0]!.items;
    expect(items[0]).toMatchObject({ label: "renamed" });
    expect(items[0]!.pose).toBe(base.stations[0]!.items[0]!.pose);
    expect(items[1]!.pose).toEqual(
      localPoseOf(moved.geo, base.stations[0]!.geo),
    );
  });

  // Why this test matters: the tour document seats every object in a
  // station from the moment it is placed or moved, and the page shows that
  // station. A writer that assigned stations again (as it once did for new
  // objects) could write an object somewhere other than the station the
  // creator was shown, so it writes each object into the station it names,
  // wherever it stands.
  it("writes each object into the station it names, however far from it, and starts no station", () => {
    const next = withTourContent(
      tour([station("gate", 0, 0), station("well", 0, 40)]),
      {
        objects: [
          inStation(pin("near-well", 0, 39), "gate"),
          inStation(pin("lone", 100, 0), "well"),
        ],
      },
    );
    expect(next.stations.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ["gate", ["near-well"]],
      ["well", ["lone"]],
    ]);
  });

  it("an object keeps the station the tour holds it in when it names none", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [inStation(pin("a", 3, 4), "gate")],
    });
    const { station: _station, ...unnamed } = tourObjects(base)[0]!;
    const next = withTourContent(base, { objects: [unnamed] });
    expect(next.stations[0]!.items.map((i) => i.id)).toEqual(["a"]);
  });

  // Why this test matters: an object that reaches the writer in no station
  // of the tour is a broken document, not a reason to invent a station: a
  // station made here would be one no page ever showed. The save fails in
  // words instead of writing it somewhere.
  it("refuses an object naming a station the tour lacks, or none at all", () => {
    const base = tour([station("gate", 0, 0)]);
    expect(() =>
      withTourContent(base, { objects: [inStation(pin("a", 0, 0), "gone")] }),
    ).toThrow(/"a".*station/);
    expect(() => withTourContent(base, { objects: [pin("b", 0, 0)] })).toThrow(
      /"b".*station/,
    );
  });

  it("keeps the stations in the order the tour has them", () => {
    const next = withTourContent(
      tour([station("c", 0, 0), station("a", 50, 0), station("b", 100, 0)]),
      {
        objects: [
          inStation(pin("in-b", 100, 0), "b"),
          inStation(pin("in-c", 0, 0), "c"),
        ],
      },
    );
    expect(next.stations.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("an object absent from the list leaves its station; the station stays", () => {
    const base = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [
        inStation(pin("a", 3, 4), "gate"),
        inStation(pin("b", -2, 1), "gate"),
      ],
    });
    const next = withTourContent(base, {
      objects: tourObjects(base).filter((o) => o.id !== "a"),
    });
    expect(next.stations.map((s) => s.items.map((i) => i.id))).toEqual([["b"]]);
  });

  it("a station emptied by this write goes when it carries nothing else; a titled or storied one stays", () => {
    // Why this test matters (tour editor plan D20): an automatic station
    // exists for the elements it holds. Deleting its last pin used to
    // leave an untitled, empty station behind, which the visitor's guide
    // still offered ("Next: Station 2, 30 m") - a walk to nothing. A
    // station with its own title or story steps is the creator's, one
    // another station routes to stays so the route still resolves, and an
    // empty station the tour already had is left alone. (A "photographed"
    // station, kept by the walk's recorded photos, stood here too: those
    // are debug camera captures now, which keep no station and which the
    // document drops at the open, withoutDebugCaptures.)
    const titled = { ...station("titled", 100, 0), title: "Old well" };
    const storied: TourStation = {
      ...station("storied", 200, 0),
      steps: [
        {
          id: "t",
          block: { kind: "text", text: "Hi" },
          advance: { mode: "tap" },
        },
      ],
      next: "routed",
    };
    const stations = [
      station("auto", 0, 0),
      titled,
      storied,
      station("was-empty", 400, 0),
      station("routed", 500, 0),
    ];
    const base = withTourContent(tour(stations), {
      objects: [
        inStation(pin("a", 1, 0), "auto"),
        inStation(pin("b", 101, 0), "titled"),
        inStation(pin("c", 201, 0), "storied"),
        inStation(pin("e", 501, 0), "routed"),
      ],
    });
    const next = withTourContent(base, { objects: [] });
    expect(next.stations.map((s) => s.id)).toEqual([
      "titled",
      "storied",
      "was-empty",
      "routed",
    ]);
  });

  // (A test that a write kept the tour's recorded photos verbatim stood
  // here: a tour the document holds carries none since the open drops
  // them, withoutDebugCaptures below.)
});

describe("withoutDebugCaptures", () => {
  // Why these tests matter: a file written before the debug camera
  // captures left the tour carries them as captureSpots, each in a
  // station, and the bake started an automatic walk-N station for every
  // frame no station held. Such a station holds no item: the capture
  // reference alone kept it, so a write that drops the captures but keeps
  // it would leave the visitor's guide leading to an empty station. The
  // open drops both; a station anything else keeps stays, and so does an
  // empty one no capture named (the creator's own).
  const capture = (image: string, stationId: string) => ({
    image,
    station: stationId,
    pose: {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
  });
  const storied = (s: TourStation): TourStation => ({
    ...s,
    steps: [
      {
        id: "t",
        block: { kind: "text", text: "Hi" },
        advance: { mode: "tap" },
      },
    ],
  });

  it("drops the captures and every station only they kept", () => {
    const gate = withTourContent(tour([station("gate", 0, 0)]), {
      objects: [inStation(pin("a", 1, 0), "gate")],
    }).stations[0]!;
    const manifest: TourManifest = {
      ...tour([
        gate,
        station("walk-1", 100, 0),
        { ...station("walk-2", 200, 0), title: "Old well" },
        storied(station("walk-3", 300, 0)),
        { ...station("walk-4", 400, 0), next: "walk-5" },
        station("walk-5", 500, 0),
        station("own-empty", 600, 0),
        station("walk-6", 700, 0),
      ]),
      captureSpots: {
        fixes: 3,
        gpsAccuracyMedianM: 4,
        captures: [
          capture("images/frame-1.jpg", "gate"),
          capture("images/frame-2.jpg", "walk-1"),
          capture("images/frame-3.jpg", "walk-2"),
          capture("images/frame-4.jpg", "walk-3"),
          capture("images/frame-5.jpg", "walk-4"),
          capture("images/frame-6.jpg", "walk-5"),
          capture("images/frame-7.jpg", "walk-6"),
          capture("images/frame-8.jpg", "walk-6"),
        ],
      },
    };
    const out = withoutDebugCaptures(manifest);
    expect("captureSpots" in out).toBe(false);
    // Kept: an item, a title, steps, a route of its own (walk-4), routed
    // to (walk-5, by walk-4), and an empty station no capture named. Gone: walk-1 and walk-6 (captures
    // only), however many captures named them.
    expect(out.stations.map((s) => s.id)).toEqual([
      "gate",
      "walk-2",
      "walk-3",
      "walk-4",
      "walk-5",
      "own-empty",
    ]);
    // What stays is the very station, untouched.
    expect(out.stations[0]).toBe(manifest.stations[0]);
  });

  it("returns the very manifest when it carries no captures", () => {
    const manifest = tour([station("own-empty", 0, 0)]);
    expect(withoutDebugCaptures(manifest)).toBe(manifest);
  });

  it("drops exactly the bare stations a capture named, keeping the order (property)", () => {
    // Why: the rule is one of exclusion; over any mix of stations and
    // capture references, what goes must be exactly the bare stations a
    // capture named, and the rest must keep their order.
    const stationArb = fc.record({
      title: fc.boolean(),
      steps: fc.boolean(),
      routedTo: fc.boolean(),
      captured: fc.nat({ max: 2 }),
    });
    fc.assert(
      fc.property(fc.array(stationArb, { maxLength: 8 }), (specs) => {
        const ids = specs.map((_, i) => `s${String(i)}`);
        const stations = specs.map((spec, i): TourStation => {
          let s = station(ids[i]!, i * 100, 0);
          if (spec.title) s = { ...s, title: "T" };
          if (spec.steps) s = storied(s);
          return s;
        });
        // A route to each station marked routedTo, from the station
        // before it (the first is routed to from the last).
        const routed = stations.map((s, i) => {
          const j = (i + 1) % stations.length;
          return specs[j]?.routedTo === true ? { ...s, next: ids[j]! } : s;
        });
        const captures = specs.flatMap((spec, i) =>
          Array.from({ length: spec.captured }, (_, k) =>
            capture(`images/f-${String(i)}-${String(k)}.jpg`, ids[i]!),
          ),
        );
        const manifest: TourManifest = {
          ...tour(routed),
          captureSpots: { fixes: 1, gpsAccuracyMedianM: null, captures },
        };
        const out = withoutDebugCaptures(manifest);
        expect("captureSpots" in out).toBe(false);
        const expected = ids.filter((_, i) => {
          const spec = specs[i]!;
          // A station routes on (`next`) when the one after it is
          // routed to, as built above.
          const routesOn = specs[(i + 1) % specs.length]?.routedTo === true;
          return (
            spec.title ||
            spec.steps ||
            spec.routedTo ||
            routesOn ||
            spec.captured === 0
          );
        });
        expect(out.stations.map((s) => s.id)).toEqual(expected);
      }),
    );
  });
});

describe("withReferencedAssets", () => {
  // Why these tests matter: a tour's media files are its assets, and a
  // visitor downloads every one the tour lists. An asset nothing uses any
  // more (its step or its cover changed) would ride along in every copy
  // for good, so the write drops it. But "uses" must cover every place an
  // asset is named - each kind of step block and the cover - or the write
  // would delete a step's media: one test per block kind.
  const asset = (id: string, kind: TourAsset["kind"]): TourAsset => {
    const ext = { image: "png", audio: "mp3", video: "mp4", model: "glb" }[
      kind
    ];
    return { id, path: `content/${id}.${ext}`, kind };
  };
  const ASSETS: readonly TourAsset[] = [
    asset("picture", "image"),
    asset("guide", "image"),
    asset("guide-voice", "audio"),
    asset("song", "audio"),
    asset("clip", "video"),
    asset("statue", "model"),
    asset("cover-art", "image"),
    asset("stray", "image"),
  ];
  /** A tour with every asset and one station telling `blocks`. */
  function telling(
    blocks: readonly TourBlock[],
    extra: Partial<TourManifest> = {},
  ): TourManifest {
    const told = {
      ...station("told", 0, 0),
      steps: blocks.map((block, i) => ({
        id: `step-${String(i)}`,
        block,
        advance: { mode: "tap" as const },
      })),
    };
    return { ...tour([told]), assets: [...ASSETS], ...extra };
  }
  const kept = (manifest: TourManifest) =>
    withReferencedAssets(manifest).assets.map((a) => a.id);

  const cases: readonly [string, TourBlock, readonly string[]][] = [
    ["an image", { kind: "image", asset: "picture" }, ["picture"]],
    [
      "a character's image and voice",
      {
        kind: "character",
        name: "Guide",
        image: "guide",
        caption: "Hello",
        voice: "guide-voice",
      },
      ["guide", "guide-voice"],
    ],
    [
      "a character without a voice",
      { kind: "character", name: "Guide", image: "guide", caption: "Hello" },
      ["guide"],
    ],
    ["an audio", { kind: "audio", asset: "song", transcript: "La" }, ["song"]],
    ["a video", { kind: "video", asset: "clip", transcript: "Look" }, ["clip"]],
    ["a model", { kind: "model", asset: "statue" }, ["statue"]],
    ["a text", { kind: "text", text: "Read me" }, []],
  ];
  for (const [name, block, ids] of cases) {
    it(`keeps what ${name} block names, and drops every other asset`, () => {
      expect(kept(telling([block]))).toEqual(ids);
    });
  }

  it("keeps the cover's image, though no step names it", () => {
    expect(kept(telling([], { cover: "cover-art" }))).toEqual(["cover-art"]);
  });

  it("counts a block in any station, in the tour's asset order", () => {
    const second = {
      ...station("second", 100, 0),
      steps: [
        {
          id: "s",
          block: { kind: "image", asset: "picture" } as const,
          advance: { mode: "tap" } as const,
        },
      ],
    };
    const manifest = telling([{ kind: "model", asset: "statue" }]);
    expect(
      kept({ ...manifest, stations: [...manifest.stations, second] }),
    ).toEqual(["picture", "statue"]);
  });

  it("returns the tour itself when every asset is in use", () => {
    const manifest = {
      ...telling([{ kind: "image", asset: "picture" }]),
      assets: [ASSETS[0]!],
    };
    expect(withReferencedAssets(manifest)).toBe(manifest);
  });
});

describe("asStored", () => {
  it("is what the written tour holds for an object, by content key", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -24, max: 24, noNaN: true }),
        fc.double({ min: -24, max: 24, noNaN: true }),
        fc.double({ min: 500, max: 540, noNaN: true }),
        (n, e, alt) => {
          const base = tour([station("gate", 0, 0)]);
          const placed = {
            ...pin("a", n, e),
            geo: geo(n, e, alt, 70),
            station: "gate",
          };
          const written = withTourContent(base, { objects: [placed] });
          const read = tourObjects(written)[0]!;
          const home = written.stations.find((s) => s.id === read.station)!;
          expect(objectContentKey(asStored(placed, home))).toBe(
            objectContentKey(read),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
