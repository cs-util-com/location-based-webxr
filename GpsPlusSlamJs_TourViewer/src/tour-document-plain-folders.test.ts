/**
 * Why these tests matter: the format lets a station group free items in
 * plain folders, each with its own pose, nested at any depth; the editor
 * keeps stories and free items only, so it flattens folders on open and
 * the next save writes their items one by one. That is acceptable only if
 * every item is written exactly where it stood: a save that dropped the
 * folders' poses would move every grouped item without a word. Each test
 * opens a tour with posed, nested folders, saves it, reads the saved file
 * back and compares every item's place in the world with the original's.
 *
 * Declared tolerances: 1e-9 degrees of latitude and longitude (about
 * 0.1 mm), 1e-6 m of altitude, and 1e-12 on 1 - |q1.q2| for the rotation
 * (about 1.4 microradians). Swept: the outer folder's yaw (0, 30, 90 and
 * 179 degrees) and its offset (0 m, 10 m and 1 km), each pair a run.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  tourStories,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
} from "./tour-document.js";

type Quat = readonly [number, number, number, number];
type Vec = [number, number, number];

const AT = { lat: 48.52, lon: 9.05, alt: 400 };
const IDENTITY: Quat = [0, 0, 0, 1];

const LAT_LON_TOLERANCE_DEG = 1e-9;
const ALT_TOLERANCE_M = 1e-6;
const ROTATION_TOLERANCE = 1e-12;

/** A turn of `deg` about Up. */
function yaw(deg: number): Quat {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function pin(id: string, position: Vec, rotation: Quat = IDENTITY) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-09T00:00:00.000Z",
    pose: { position, rotation: [...rotation] },
  } as const;
}

/** A station with a story, a free item, and two folders nested in each
 *  other, the outer one at `offsetM` north turned by `yawDeg`, the inner
 *  one tilted about North, so the two turns do not commute. */
function tourWithFolders(yawDeg: number, offsetM: number): TourManifest {
  const wire = tourOf([], {
    stations: [
      {
        id: "well",
        title: "The well",
        geo: { ...AT, rotation: [0, 0, 0, 1] },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([
          storyOf("miller", [
            {
              id: "m1",
              kind: "shortText",
              view: "card",
              caption: "The miller",
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            },
          ]),
          pin("free", [1, 0, 2]),
          {
            id: "outer",
            kind: "folder",
            pose: { position: [offsetM, 1, 3], rotation: [...yaw(yawDeg)] },
            scale: 1,
            children: [
              pin("a", [2, 0, 0], yaw(10)),
              {
                id: "inner",
                kind: "folder",
                pose: {
                  position: [0, 0.5, -4],
                  rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
                },
                children: [pin("b", [1, 2, 3]), pin("c", [-3, 0, 1])],
              },
            ],
          },
          { id: "empty", kind: "folder", children: [] },
        ]),
      },
    ],
  });
  return parseTourManifest(JSON.parse(serializeTourManifest(wire)));
}

function savedAfterOpening(manifest: TourManifest): TourManifest {
  const state = reduce(initialTourDocumentState, act.opened({ manifest }));
  const out = manifestToWrite(state);
  if (out === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(out)));
}

function rotationGap(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 1 - Math.min(1, dot);
}

describe("a tour with plain folders, saved by the editor", () => {
  for (const yawDeg of [0, 30, 90, 179]) {
    for (const offsetM of [0, 10, 1000]) {
      it(`writes every grouped item where it stood (outer folder turned ${String(yawDeg)} degrees, ${String(offsetM)} m out)`, () => {
        const opened = tourWithFolders(yawDeg, offsetM);
        const saved = savedAfterOpening(opened);
        const before = new Map(tourObjects(opened).map((o) => [o.id, o]));
        const after = tourObjects(saved);
        expect(after.map((o) => o.id).sort()).toEqual(
          [...before.keys()].sort(),
        );
        for (const object of after) {
          const original = before.get(object.id);
          if (original === undefined) throw new Error(object.id);
          expect(
            Math.abs(object.geo.lat - original.geo.lat),
          ).toBeLessThanOrEqual(LAT_LON_TOLERANCE_DEG);
          expect(
            Math.abs(object.geo.lon - original.geo.lon),
          ).toBeLessThanOrEqual(LAT_LON_TOLERANCE_DEG);
          expect(
            Math.abs(object.geo.alt - original.geo.alt),
          ).toBeLessThanOrEqual(ALT_TOLERANCE_M);
          expect(
            rotationGap(
              object.geo.rotation ?? IDENTITY,
              original.geo.rotation ?? IDENTITY,
            ),
          ).toBeLessThanOrEqual(ROTATION_TOLERANCE);
        }
      });
    }
  }

  it("writes the grouped items at the station's top, keeps the story, and leaves the folders out", () => {
    const saved = savedAfterOpening(tourWithFolders(30, 10));
    const station = saved.stations[0];
    if (station === undefined) throw new Error("no station");
    expect(station.children.some(isTourFolder)).toBe(false);
    expect(tourStories(station).map((s) => s.id)).toEqual(["miller"]);
    expect(station.children.map((c) => c.id)).toEqual([
      "miller",
      "free",
      "a",
      "b",
      "c",
    ]);
  });
});
