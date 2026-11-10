/**
 * Why these tests matter: the format lets a station group free items in
 * plain folders, each with its own pose, nested at any depth. The editor
 * keeps them: a tour opened and saved must come back with the same
 * folders, every item in the folder it was in at the very pose it had
 * there, and a save that moved one item must change that item's pose
 * alone. A save that re-expressed the poses would nudge every grouped
 * item; one that dropped the folders would lose the creator's grouping.
 * Each test opens a tour with posed, nested folders, edits it or not,
 * saves it, reads the saved file back and compares.
 *
 * Declared tolerances, for a pose the editor computes (an item moved):
 * 1e-9 degrees of latitude and longitude (about 0.1 mm), 1e-6 m of
 * altitude and of a local offset, and 1e-12 on 1 - |q1.q2| for a rotation
 * (about 1.4 microradians). Swept: the outer folder's yaw (0, 30, 90 and
 * 179 degrees) and its offset (0 m, 10 m and 1 km), each pair a run. A
 * pose nobody moved is compared exactly.
 */
import {
  parseTourManifest,
  parseTourObject,
  serializeTourManifest,
  tourObjectRecord,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourLocalPose } from "gps-plus-slam-app-framework/ar/tour-items";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  type TourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  documentFrames,
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import {
  parseSettingsRecord,
  settingsRecord,
  settingsRecordText,
} from "./tour-document-draft.js";

type Quat = readonly [number, number, number, number];
type Vec = [number, number, number];

const AT = { lat: 48.52, lon: 9.05, alt: 400 };
const IDENTITY: Quat = [0, 0, 0, 1];

const LAT_LON_TOLERANCE_DEG = 1e-9;
const ALT_TOLERANCE_M = 1e-6;
const OFFSET_TOLERANCE_M = 1e-6;
const ROTATION_TOLERANCE = 1e-12;

const SWEEP_YAWS = [0, 30, 90, 179];
const SWEEP_OFFSETS = [0, 10, 1000];

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

/** A station with a story, a free item, two titled folders nested in each
 *  other, the outer one at `offsetM` north turned by `yawDeg`, the inner
 *  one tilted about North, so the two turns do not commute, and an empty
 *  folder. Items stand before the folders in the outer one, so a write
 *  that orders groups first shows. */
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
            title: "Courtyard",
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

function opened(manifest: TourManifest): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest }));
}

function saved(state: TourDocumentState): TourManifest {
  const out = manifestToWrite(state);
  if (out === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(out)));
}

function rotationGap(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 1 - Math.min(1, dot);
}

function expectSameGeo(a: TourObject["geo"], b: TourObject["geo"]): void {
  expect(Math.abs(a.lat - b.lat)).toBeLessThanOrEqual(LAT_LON_TOLERANCE_DEG);
  expect(Math.abs(a.lon - b.lon)).toBeLessThanOrEqual(LAT_LON_TOLERANCE_DEG);
  expect(Math.abs(a.alt - b.alt)).toBeLessThanOrEqual(ALT_TOLERANCE_M);
  expect(
    rotationGap(a.rotation ?? IDENTITY, b.rotation ?? IDENTITY),
  ).toBeLessThanOrEqual(ROTATION_TOLERANCE);
}

function expectSamePose(a: TourLocalPose, b: TourLocalPose): void {
  for (const i of [0, 1, 2] as const) {
    expect(Math.abs(a.position[i] - b.position[i])).toBeLessThanOrEqual(
      OFFSET_TOLERANCE_M,
    );
  }
  expect(rotationGap(a.rotation, b.rotation)).toBeLessThanOrEqual(
    ROTATION_TOLERANCE,
  );
}

/** The station's children with every level ordered as a write orders
 *  them: groups (stories and folders) first, then items, each in its
 *  order. */
function groupsFirst(
  children: readonly TourStationChild[],
): TourStationChild[] {
  const order = (list: readonly TourStationChild[]): TourStationChild[] => [
    ...list
      .filter((c) => c.kind === "folder")
      .map((c) =>
        isTourFolder(c)
          ? {
              ...c,
              children: order(c.children) as TourFolder["children"],
            }
          : c,
      ),
    ...list.filter((c) => c.kind !== "folder"),
  ];
  return order(children);
}

/** The plain folder `id` of the tour's first station, at any depth. */
function folderIn(manifest: TourManifest, id: string): TourFolder {
  const find = (list: readonly TourStationChild[]): TourFolder | undefined => {
    for (const child of list) {
      if (!isTourFolder(child)) continue;
      if (child.id === id) return child;
      const inner = find(child.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  const found = find(manifest.stations[0]?.children ?? []);
  if (found === undefined) throw new Error(`no folder ${id}`);
  return found;
}

/** The pose of the free block `id` in the folder (or station) holding it. */
function poseIn(manifest: TourManifest, id: string): TourLocalPose {
  const find = (
    list: readonly TourStationChild[],
  ): TourLocalPose | undefined => {
    for (const child of list) {
      if (child.id === id && "pose" in child && child.pose !== undefined) {
        return child.pose;
      }
      if (isTourFolder(child)) {
        const inner = find(child.children);
        if (inner !== undefined) return inner;
      }
    }
    return undefined;
  };
  const found = find(manifest.stations[0]?.children ?? []);
  if (found === undefined) throw new Error(`no block ${id}`);
  return found;
}

function objectOf(state: TourDocumentState, id: string): TourObject {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) throw new Error(`no object ${id}`);
  return found.object;
}

/** `object` moved `northM` metres north (about, 1e-5 degrees a metre). */
function nudged(object: TourObject, northM: number): TourObject {
  return {
    ...object,
    geo: { ...object.geo, lat: object.geo.lat + northM * 9e-6 },
  };
}

/** What a reload brings back: the record as stored, read against the
 *  opened tour, and the objects' records as a draft stores them,
 *  restored into a fresh open. */
function reloaded(
  state: TourDocumentState,
  manifest: TourManifest,
): TourDocumentState {
  const record = parseSettingsRecord(
    settingsRecordText(settingsRecord(state)),
    manifest,
  );
  if (record === undefined) throw new Error("the record did not read");
  return reduce(
    opened(manifest),
    act.restored({
      objects: state.placed.map((p) =>
        parseTourObject(JSON.parse(JSON.stringify(tourObjectRecord(p.object)))),
      ),
      deleted: [...state.deleted],
      ...(record.frames === undefined ? {} : { frames: record.frames }),
      ...(record.order === undefined ? {} : { order: record.order }),
      what: "restore",
    }),
  );
}

describe("a tour with plain folders, saved by the editor", () => {
  for (const yawDeg of SWEEP_YAWS) {
    for (const offsetM of SWEEP_OFFSETS) {
      it(`writes every grouped item where it stood (outer folder turned ${String(yawDeg)} degrees, ${String(offsetM)} m out)`, () => {
        const tour = tourWithFolders(yawDeg, offsetM);
        const out = saved(opened(tour));
        const before = new Map(tourObjects(tour).map((o) => [o.id, o]));
        const after = tourObjects(out);
        expect(after.map((o) => o.id).sort()).toEqual(
          [...before.keys()].sort(),
        );
        for (const object of after) {
          const original = before.get(object.id);
          if (original === undefined) throw new Error(object.id);
          expectSameGeo(object.geo, original.geo);
        }
      });
    }
  }

  it("keeps the folders whole: their titles, poses and nesting, each item in its folder at its very pose, groups first", () => {
    const tour = tourWithFolders(30, 10);
    const station = saved(opened(tour)).stations[0];
    if (station === undefined) throw new Error("no station");
    expect(station.children.map((c) => c.id)).toEqual([
      "miller",
      "outer",
      "empty",
      "free",
    ]);
    // Exact: a save nobody edited writes the numbers it read.
    expect(station.children).toEqual(
      groupsFirst(tour.stations[0]?.children ?? []),
    );
  });

  it("moves an item alone and changes only its own pose in its folder", () => {
    for (const yawDeg of SWEEP_YAWS) {
      for (const offsetM of SWEEP_OFFSETS) {
        const tour = tourWithFolders(yawDeg, offsetM);
        const b = nudged(objectOf(opened(tour), "b"), 2);
        const out = saved(
          reduce(opened(tour), act.moved({ object: b, what: "move" })),
        );
        const outer = folderIn(out, "outer");
        const inner = folderIn(out, "inner");
        expect(outer.pose).toEqual(folderIn(tour, "outer").pose);
        expect(inner.pose).toEqual(folderIn(tour, "inner").pose);
        expect(inner.children.map((c) => c.id)).toEqual(["b", "c"]);
        for (const id of ["a", "c", "free"]) {
          expect(poseIn(out, id)).toEqual(poseIn(tour, id));
        }
        const movedB = tourObjects(out).find((o) => o.id === "b");
        if (movedB === undefined) throw new Error("b gone");
        expectSameGeo(movedB.geo, b.geo);
      }
    }
  });
});

describe("a plain folder moved with its items", () => {
  const TURNED: TourLocalPose = {
    position: [12, 1.5, -7],
    rotation: [...yaw(45)] as [number, number, number, number],
  };

  it("moves the folder alone in the file: its items keep their poses in it, as one step", () => {
    for (const yawDeg of SWEEP_YAWS) {
      for (const offsetM of SWEEP_OFFSETS) {
        const tour = tourWithFolders(yawDeg, offsetM);
        const start = opened(tour);
        const moved = reduce(
          start,
          act.folderMoved({
            stationId: "well",
            folderId: "outer",
            pose: TURNED,
            what: "move folder",
          }),
        );
        expect(moved.past).toHaveLength(start.past.length + 1);
        const out = saved(moved);
        expect(folderIn(out, "outer").pose).toEqual(TURNED);
        expect(folderIn(out, "outer").scale ?? 1).toBe(1);
        expect(folderIn(out, "inner").pose).toEqual(
          folderIn(tour, "inner").pose,
        );
        for (const id of ["a", "b", "c", "free"]) {
          expect(poseIn(out, id)).toEqual(poseIn(tour, id));
        }
        // The world view follows: a, b and c moved, the free item did not.
        const free = tourObjects(out).find((o) => o.id === "free");
        const freeBefore = tourObjects(tour).find((o) => o.id === "free");
        if (free === undefined || freeBefore === undefined) throw new Error();
        expect(free.geo).toEqual(freeBefore.geo);
        expect(objectOf(moved, "a").geo).not.toEqual(objectOf(start, "a").geo);
        expect(saved(reduce(moved, act.undone()))).toEqual(saved(start));
      }
    }
  });

  it("carries an item this page moved before: it keeps its pose in its folder", () => {
    for (const yawDeg of SWEEP_YAWS) {
      for (const offsetM of SWEEP_OFFSETS) {
        const tour = tourWithFolders(yawDeg, offsetM);
        const nudgedB = reduce(
          opened(tour),
          act.moved({
            object: nudged(objectOf(opened(tour), "b"), 2),
            what: "m",
          }),
        );
        const inFolder = poseIn(saved(nudgedB), "b");
        const out = saved(
          reduce(
            nudgedB,
            act.folderMoved({
              stationId: "well",
              folderId: "outer",
              pose: TURNED,
              what: "move folder",
            }),
          ),
        );
        expectSamePose(poseIn(out, "b"), inFolder);
        expect(poseIn(out, "c")).toEqual(poseIn(tour, "c"));
      }
    }
  });

  it("refuses an unknown station or folder, a pose the format refuses, and an unchanged pose", () => {
    const start = opened(tourWithFolders(30, 10));
    const tries = [
      { stationId: "nowhere", folderId: "outer", pose: TURNED },
      { stationId: "well", folderId: "nothing", pose: TURNED },
      { stationId: "well", folderId: "miller", pose: TURNED },
      {
        stationId: "well",
        folderId: "outer",
        pose: { position: [20_000, 0, 0], rotation: [0, 0, 0, 1] },
      },
      {
        stationId: "well",
        folderId: "outer",
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 0] },
      },
      {
        stationId: "well",
        folderId: "outer",
        pose: folderIn(tourWithFolders(30, 10), "outer").pose,
      },
    ] as const;
    for (const t of tries) {
      const after = reduce(
        start,
        act.folderMoved({ ...t, pose: t.pose as TourLocalPose, what: "x" }),
      );
      expect(after).toBe(start);
    }
  });

  it("comes back from the draft after a reload", () => {
    const tour = tourWithFolders(90, 10);
    const state = reduce(
      reduce(
        opened(tour),
        act.moved({
          object: nudged(objectOf(opened(tour), "c"), 1),
          what: "m",
        }),
      ),
      act.folderMoved({
        stationId: "well",
        folderId: "inner",
        pose: TURNED,
        what: "move folder",
      }),
    );
    const back = reloaded(state, tour);
    expect(documentFrames(back)).toEqual(documentFrames(state));
    expect(saved(back)).toEqual(saved(state));
  });
});
