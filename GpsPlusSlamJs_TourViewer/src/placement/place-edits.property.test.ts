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
  type TourManifest,
  type TourObject,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { openTourFile, type TourSession } from "../tour-session.js";
import { manifestToWrite } from "../tour-document.js";
import { editorStore } from "../test-support/editor-store.js";
import { stationIdOf, tourOf } from "../test-support/tour-of.js";
import {
  startGesture,
  type GestureTarget,
  type GestureWorld,
} from "../editor3d/gesture.js";
import { createEditorSession } from "../editor/editor-session.js";
import { angleDiffDeg } from "../editor3d/gizmo-maths.js";
import { headingOfGeo, turnedGeo } from "../editor3d/pose-edits.js";
import { applyPlaceEdit } from "./place-edits.js";
import { placeableOf } from "./placeables.js";
import { STATION_PLACEMENT } from "./placement-rows.js";

beforeAll(() => {
  editorStore();
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

function pin(id: string, east: number, north: number, alt: number): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `pin ${id}`,
    createdAtIso: "2026-10-22T00:00:00.000Z",
    geo: {
      lat: LAT + north / M_LAT,
      lon: LON + east / M_LON,
      alt,
      rotation: [0, 0, 0, 1],
    },
  };
}

async function opened(
  objects: TourObject[] | TourManifest,
): Promise<TourSession> {
  const manifest = parseTourManifest(
    JSON.parse(
      serializeTourManifest(Array.isArray(objects) ? tourOf(objects) : objects),
    ),
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
                ref: { kind: "block", id: "p" },
                geo,
                turns: false,
                lifts: true,
                extent: null,
                locked: false,
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
            const store = editorStore();
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
            // The item turns here although a pin's row faces the camera:
            // what is under test is the undo of a turn written through the
            // session, which a turning row (a lectern, a picture) writes
            // the same way.
            const target: GestureTarget = what.startsWith("item")
              ? {
                  ref: { kind: "block", id: "a" },
                  geo: objects[0]!.geo,
                  turns: true,
                  lifts: true,
                  extent: null,
                  locked: false,
                  centre: { x: 0, y: 0, z: 0 },
                }
              : {
                  ref: { kind: "station", id: station.id },
                  geo: station.geo,
                  turns: STATION_PLACEMENT.turns,
                  lifts: STATION_PLACEMENT.lifts,
                  extent:
                    STATION_PLACEMENT.extent === undefined
                      ? null
                      : {
                          ...STATION_PLACEMENT.extent,
                          value: station.foundRadiusM,
                        },
                  locked: false,
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
              edit === null ? "applied" : applyPlaceEdit(editor, edit).kind;
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

/** A pin of a station's frame at `position` (north, up, east). */
function localPin(id: string, position: [number, number, number]) {
  return {
    id,
    kind: "shortText" as const,
    view: "pin" as const,
    caption: `pin ${id}`,
    createdAtIso: "2026-10-22T00:00:00.000Z",
    pose: {
      position,
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
  };
}

/** One station holding the folder `grp` (turned, off its anchor) with two
 *  pins and an inner folder of scale 2 holding a third. */
function folderTour(): TourManifest {
  const base = tourOf([pin("anchor", 0, 0, 520)]);
  const [station] = base.stations;
  if (station === undefined) throw new Error("no station");
  const half = Math.PI / 12;
  return {
    ...base,
    stations: [
      {
        ...station,
        children: [
          {
            id: "grp",
            kind: "folder",
            title: "Benches",
            pose: {
              position: [2, 0, 1],
              rotation: [0, Math.sin(half), 0, Math.cos(half)],
            },
            children: [
              localPin("m1", [3, 0, 1]),
              localPin("m2", [-2, 0.5, 4]),
              {
                id: "inner",
                kind: "folder",
                pose: { position: [1, 0, -1], rotation: [0, 0, 0, 1] },
                scale: 2,
                children: [localPin("m3", [0.5, 0, 0.5])],
              },
            ],
          },
        ],
      },
    ],
  } as TourManifest;
}

/** Ground distance between two spots, in metres (a local ruler: exact
 *  enough within the 10 km a station holds). */
function metresApart(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const north = (a.lat - b.lat) * 111_320;
  const east = (a.lon - b.lon) * 111_320 * Math.cos((b.lat * Math.PI) / 180);
  return Math.hypot(north, east);
}

describe("a folder's gesture written back", () => {
  // Why: a folder's gizmo writes the folder's pose in the WORLD and its
  // scale; the document stores the pose in its station's frame (the world
  // pose decomposed) and draws its items composed through it. The round
  // trip must give back exactly what the gizmo wrote, its items must
  // follow at the written scale, and each gesture must be one undo step
  // that restores the tour exactly (and one redo that re-applies it).
  // Swept: any turn, offsets up to 7 km on each axis (under 10 km from
  // the anchor, the bound every composed item is held to), and factors
  // over the whole allowed range, its two ends and 1 (no change) drawn on
  // purpose. The station frame is a local tangent ruler, so a spot 7 km
  // out comes back within a tenth of a millimetre, not bit for bit: the
  // bound is a millimetre on the ground.
  it("gives back the written pose and scale, carries its items, and undoes and redoes exactly", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -360, max: 360, noNaN: true }),
        fc.double({ min: -7000, max: 7000, noNaN: true }),
        fc.double({ min: -7000, max: 7000, noNaN: true }),
        fc.oneof(
          fc.constantFrom(0.1, 10, 1),
          fc.double({ min: 0.1, max: 10, noNaN: true }),
        ),
        async (yawDeg, eastM, northM, factor) => {
          const manifest = folderTour();
          const session = await opened(manifest);
          const store = editorStore();
          const editor = createEditorSession({
            session,
            manifest: parseTourManifest(
              JSON.parse(serializeTourManifest(manifest)),
            ),
            levels: new Map(),
            store,
          });
          const tour = () => {
            const out = manifestToWrite(store.getState().tourDocument);
            if (out === null) throw new Error("nothing open");
            return out;
          };
          const folder = () => {
            const p = placeableOf(tour(), "folder:grp");
            if (p === null) throw new Error("no folder");
            return p;
          };
          const before = tour();
          const turned = turnedGeo(folder().geo, yawDeg);
          const written = {
            ...turned,
            lat: turned.lat + northM / 111_320,
            lon:
              turned.lon +
              eastM / (111_320 * Math.cos((turned.lat * Math.PI) / 180)),
          };
          expect(
            applyPlaceEdit(editor, {
              kind: "pose",
              ref: { kind: "folder", id: "grp" },
              geo: written,
            }),
          ).toEqual({ kind: "applied" });
          const back = folder().geo;
          expect(metresApart(back, written)).toBeLessThan(1e-3);
          expect(Math.abs(back.alt - written.alt)).toBeLessThan(1e-6);
          expect(
            Math.abs(angleDiffDeg(headingOfGeo(back), headingOfGeo(written))),
          ).toBeLessThan(1e-6);
          const moved = tour();

          expect(
            applyPlaceEdit(editor, {
              kind: "extent",
              ref: { kind: "folder", id: "grp" },
              value: factor,
            }),
          ).toEqual({ kind: "applied" });
          const scaled = folder();
          expect(scaled.extent?.value).toBe(factor);
          expect(metresApart(scaled.geo, written)).toBeLessThan(1e-3);
          // Its items: at `factor` times their distance in it, drawn at
          // its scale (the inner folder's composed in).
          const pivot = scaled.inStation?.position ?? [0, 0, 0];
          for (const id of ["m1", "m2"]) {
            const m = placeableOf(tour(), id);
            const local = m?.local?.position ?? [0, 0, 0];
            const at = m?.inStation?.position ?? [0, 0, 0];
            expect(
              Math.hypot(at[0] - pivot[0], at[1] - pivot[1], at[2] - pivot[2]),
            ).toBeCloseTo(factor * Math.hypot(...local), 6);
            expect(m?.inheritedScale).toBe(factor);
          }
          expect(placeableOf(tour(), "m3")?.inheritedScale).toBeCloseTo(
            2 * factor,
            12,
          );
          const after = tour();

          // One undo per gesture: the scale, then the move.
          editor.undo();
          expect(tour()).toEqual(factor === 1 ? before : moved);
          if (factor !== 1) {
            editor.undo();
            expect(tour()).toEqual(before);
          }
          editor.redo();
          if (factor !== 1) editor.redo();
          expect(tour()).toEqual(after);
          await session.close();
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
