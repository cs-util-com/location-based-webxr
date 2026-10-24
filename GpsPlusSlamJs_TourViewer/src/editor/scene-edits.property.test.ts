/**
 * Why these tests matter: a drag in the 3D view is one gesture, and the
 * creator's Undo must take the whole of it back - exactly, to the last
 * bit of the pose, also when the drag carried an item out of its station
 * (the station rule then seats it in another station, or in a new one)
 * and when it turned or resized something. And whatever the ground under
 * the drag looks like, an item dragged over it stays as high above it as
 * it was: a pin on a hillside never sinks into the next slope. The drags
 * run through the real gesture, the real editor session and the real
 * tour document; the ground is the test's own function.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { openTourFile, type TourSession } from "../tour-session.js";
import { manifestToWrite } from "../tour-document.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { stationIdOf, tourOf } from "../test-support/v3-tour.js";
import {
  startGesture,
  type GestureTarget,
  type GestureWorld,
} from "../editor3d/gesture.js";
import { createEditorSession } from "./editor-session.js";
import { applySceneEdit } from "./scene-edits.js";

beforeAll(() => {
  createTourViewerStore();
});

const LAT = 48.137;
const LON = 11.575;
/** Metres per degree, the test world's own ruler (not the stack's). */
const M_LAT = 111_000;
const M_LON = 74_000;

/** A ground of up to three hills of `amplitudeM`, from `seed`. */
function hills(seed: readonly number[], amplitudeM: number) {
  return (p: { lat: number; lon: number }) => {
    const x = (p.lon - LON) * M_LON;
    const z = -(p.lat - LAT) * M_LAT;
    let h = 520;
    for (let i = 0; i + 3 < seed.length; i += 4) {
      const [cx = 0, cz = 0, w = 1, a = 0] = seed.slice(i, i + 4);
      h +=
        amplitudeM *
        a *
        Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * (5 + w * 200) ** 2));
    }
    return h;
  };
}

/** A world where a pixel is a metre on the ground (x east, the screen's
 *  y south) and `ground` is the ellipsoidal height; `holes` say where it
 *  has not loaded yet. */
function world(
  ground: (p: { lat: number; lon: number }) => number,
  holes: (x: number, z: number) => boolean = () => false,
): GestureWorld {
  return {
    groundUnder: (p) =>
      holes(p.x, p.y)
        ? { miss: "not-loaded" }
        : { at: { x: p.x, y: 0, z: p.y } },
    planeUnder: (p, y) => ({ x: p.x, y, z: p.y }),
    placeOf: (at) => ({ lat: LAT - at.z / M_LAT, lon: LON + at.x / M_LON }),
    groundAt: (place) => ground(place),
  };
}

function pin(id: string, east: number, north: number, alt: number): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-22T00:00:00.000Z",
    geo: {
      lat: LAT + north / M_LAT,
      lon: LON + east / M_LON,
      alt,
      rotation: [0, 0, 0, 1],
    },
  };
}

async function opened(objects: TourObject[]): Promise<TourSession> {
  const manifest = parseTourManifest(
    JSON.parse(serializeTourManifest(tourOf(objects))),
  );
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
  ]);
  return openTourFile(new File([zip], "tour.zip", { type: "application/zip" }));
}

const seeds = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
  minLength: 12,
  maxLength: 12,
});

describe("a dragged item over any ground", () => {
  // Swept: the hills' height 0, 5, 50 and 300 m; the drag's reach 10, 100
  // and 1000 m; with and without patches of ground not loaded yet. The
  // verdict holds across the whole range: the height above the ground at
  // every shown step equals the height at the grab within 1e-6 m.
  for (const amplitudeM of [0, 5, 50, 300]) {
    for (const reachM of [10, 100, 1000]) {
      it(`keeps its height above hills of ${String(amplitudeM)} m over ${String(reachM)} m`, () => {
        fc.assert(
          fc.property(
            seeds,
            fc.array(
              fc.tuple(
                fc.double({ min: -reachM, max: reachM, noNaN: true }),
                fc.double({ min: -reachM, max: reachM, noNaN: true }),
              ),
              { minLength: 1, maxLength: 20 },
            ),
            fc.boolean(),
            fc.double({ min: 0, max: 20, noNaN: true }),
            (seed, path, patchy, above) => {
              const ground = hills(seed, amplitudeM);
              const holes = patchy
                ? (x: number, z: number) =>
                    Math.sin(x / 7) * Math.cos(z / 5) > 0.6
                : () => false;
              const w = world(ground, holes);
              const geo = {
                lat: LAT,
                lon: LON,
                alt: ground({ lat: LAT, lon: LON }) + above,
                rotation: [0, 0, 0, 1] as [number, number, number, number],
              };
              const target: GestureTarget = {
                kind: "item",
                id: "p",
                geo,
                sizeM: null,
                centre: { x: 0, y: 0, z: 0 },
              };
              const g = startGesture("move", target, { x: 0, y: 0 }, w);
              expect(g).not.toBeNull();
              for (const [x, z] of path) {
                g?.move({ x, y: z }, false);
                g?.retry();
                const shown = g?.preview().geo ?? geo;
                expect(shown.alt - ground(shown)).toBeCloseTo(above, 6);
              }
            },
          ),
          { numRuns: 40 },
        );
      });
    }
  }
});

describe("a gesture and its undo", () => {
  // Swept: the drag's reach 1, 20 and 200 m against a 25 m found radius
  // (so the far drags carry the item out of its station and the station
  // rule seats it anew), each handle (move, turn, a station's dot, a
  // station's move), the hills' height 0 and 50 m. The verdict holds
  // across the range: the undo restores the tour exactly (deep-equal).
  for (const reachM of [1, 20, 200]) {
    it(`restores the tour exactly after one gesture of up to ${String(reachM)} m`, async () => {
      await fc.assert(
        fc.asyncProperty(
          seeds,
          fc.constantFrom(0, 50),
          fc.constantFrom(
            "item-move",
            "item-turn",
            "station-move",
            "station-turn",
            "station-dot",
          ),
          fc.array(
            fc.tuple(
              fc.double({ min: -reachM, max: reachM, noNaN: true }),
              fc.double({ min: -reachM, max: reachM, noNaN: true }),
            ),
            { minLength: 1, maxLength: 8 },
          ),
          async (seed, amplitudeM, what, path) => {
            const ground = hills(seed, amplitudeM);
            const objects = [
              pin("a", 0, 0, ground({ lat: LAT, lon: LON }) + 1.5),
              pin("b", 60, 0, 530),
            ];
            const session = await opened(objects);
            const store = createTourViewerStore();
            const editor = createEditorSession({
              session,
              manifest: parseTourManifest(
                JSON.parse(serializeTourManifest(tourOf(objects))),
              ),
              levels: new Map(),
              store,
            });
            const before = manifestToWrite(store.getState().tourDocument);
            const tour = before?.stations ?? [];
            const station = tour.find((s) => s.id === stationIdOf("a"));
            if (station === undefined) throw new Error("no station a");
            const target: GestureTarget = what.startsWith("item")
              ? {
                  kind: "item",
                  id: "a",
                  geo: objects[0]!.geo,
                  sizeM: null,
                  centre: { x: 0, y: 0, z: 0 },
                }
              : {
                  kind: "station",
                  id: station.id,
                  geo: station.geo,
                  foundRadiusM: station.foundRadiusM,
                  centre: { x: 0, y: 0, z: 0 },
                };
            const handle = what.endsWith("turn")
              ? "turn"
              : what.endsWith("dot")
                ? "dot"
                : "move";
            const grab = handle === "move" ? { x: 0, y: 0 } : { x: 0, y: -5 };
            const g = startGesture(handle, target, grab, world(ground));
            for (const [x, z] of path) g?.move({ x, y: z }, false);
            const edit = g?.edit() ?? null;
            // A gesture that changed nothing writes nothing to undo.
            const applied =
              edit === null ? "applied" : applySceneEdit(editor, edit).kind;
            expect(applied).toBe("applied");
            const undone = edit === null ? "undone" : editor.undo().kind;
            expect(undone).toBe("undone");
            expect(manifestToWrite(store.getState().tourDocument)).toEqual(
              before,
            );
            await session.close();
          },
        ),
        { numRuns: 25 },
      );
    });
  }
});
