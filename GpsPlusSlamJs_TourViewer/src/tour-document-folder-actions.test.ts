/**
 * Why these tests matter: the editor's folder actions (group, ungroup,
 * move into or out of a folder, rename, delete) change how a station's
 * items are grouped, never where they stand: a creator who groups three
 * benches must find them where they were, in the editor and for the
 * visitor. Each action must also be ONE undo step and refuse what the
 * format or the one-level editor cannot hold, changing nothing. Each test
 * opens a tour with folders, acts, and compares the world poses, the
 * saved file and the undo.
 *
 * Declared tolerances, for a pose the editor re-expresses in a new
 * folder: 1e-9 degrees of latitude and longitude (about 0.1 mm), 1e-6 m
 * of altitude, 1e-12 on 1 - |q1.q2| for a rotation. Swept: the outer
 * folder's yaw (0, 45 and 179 degrees) and its offset (0 m, 25 m and
 * 2 km).
 */
import {
  parseTourManifest,
  parseTourObject,
  serializeTourManifest,
  tourObjectRecord,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  tourObjects,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  type TourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { hostedObjects } from "./authoring-draft.js";
import { presentWorldBlocks } from "./shown-blocks.js";
import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  documentFrames,
  documentObjects,
  folderDropRefusal,
  groupRefusal,
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
const ROTATION_TOLERANCE = 1e-12;

const SWEEP: readonly (readonly [number, number])[] = [0, 45, 179].flatMap(
  (yawDeg) => [0, 25, 2000].map((offsetM) => [yawDeg, offsetM] as const),
);

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

/** Station "well": a story, free items p, q, r, and folder "outer"
 *  (`offsetM` north, turned `yawDeg`) holding item a and folder "inner"
 *  (tilted) holding item b, then an empty folder "spare". Station "gate"
 *  holds item g. */
function tour(yawDeg = 45, offsetM = 25): TourManifest {
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
          pin("p", [1, 0, 2]),
          pin("q", [3, 0, -2], yaw(20)),
          pin("r", [-4, 1, 0]),
          {
            id: "outer",
            kind: "folder",
            title: "Courtyard",
            pose: { position: [offsetM, 1, 3], rotation: [...yaw(yawDeg)] },
            children: [
              pin("a", [2, 0, 0], yaw(10)),
              {
                id: "inner",
                kind: "folder",
                pose: {
                  position: [0, 0.5, -4],
                  rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
                },
                children: [pin("b", [1, 2, 3])],
              },
            ],
          },
          { id: "spare", kind: "folder", title: "Spare", children: [] },
        ]),
      },
      {
        id: "gate",
        title: "The gate",
        geo: {
          lat: AT.lat + 0.001,
          lon: AT.lon,
          alt: AT.alt,
          rotation: [0, 0, 0, 1],
        },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([pin("g", [0, 0, 1])]),
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

function objectOf(state: TourDocumentState, id: string): TourObject {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) throw new Error(`no object ${id}`);
  return found.object;
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

/** Every item of `after` stands where it stood in `before`: in the
 *  document, and in the saved file read back. */
function expectNothingMoved(
  before: TourDocumentState,
  after: TourDocumentState,
): void {
  const was = new Map(
    documentObjects(before).map((o) => [o.object.id, o.object.geo]),
  );
  for (const { object } of documentObjects(after)) {
    const geo = was.get(object.id);
    if (geo === undefined) throw new Error(`new object ${object.id}`);
    expectSameGeo(object.geo, geo);
  }
  for (const object of tourObjects(saved(after))) {
    const geo = was.get(object.id);
    if (geo === undefined) throw new Error(`new object ${object.id}`);
    expectSameGeo(object.geo, geo);
  }
}

/** The plain folder `id` of station "well" in `manifest`, or undefined. */
function folderIn(manifest: TourManifest, id: string): TourFolder | undefined {
  const find = (list: readonly TourStationChild[]): TourFolder | undefined => {
    for (const child of list) {
      if (!isTourFolder(child)) continue;
      if (child.id === id) return child;
      const inner = find(child.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return find(manifest.stations.find((s) => s.id === "well")?.children ?? []);
}

function wellChildren(manifest: TourManifest): string[] {
  return (
    manifest.stations.find((s) => s.id === "well")?.children.map((c) => c.id) ??
    []
  );
}

/** What a reload brings back (the draft's record and the objects'
 *  records, restored into a fresh open): only the objects the file does
 *  not already hold as they are, as a restore offers them
 *  (`draftObjectsNotYetHosted`). */
function reloaded(
  state: TourDocumentState,
  manifest: TourManifest,
): TourDocumentState {
  const record = parseSettingsRecord(
    settingsRecordText(settingsRecord(state)),
    manifest,
  );
  if (record === undefined) throw new Error("the record did not read");
  const hosted = hostedObjects(manifest);
  return reduce(
    opened(manifest),
    act.restored({
      objects: state.placed
        .filter((p) => !hosted.holds(p.object))
        .map((p) =>
          parseTourObject(
            JSON.parse(JSON.stringify(tourObjectRecord(p.object))),
          ),
        ),
      deleted: [...state.deleted],
      ...(record.frames === undefined ? {} : { frames: record.frames }),
      ...(record.order === undefined ? {} : { order: record.order }),
      ...(record.deletedStations === undefined
        ? {}
        : { deletedStations: record.deletedStations }),
      what: "restore",
    }),
  );
}

const group = (ids: string[], title = "Benches", folderId = "grp") =>
  act.folderGrouped({ folderId, title, ids, what: "group" });

describe("grouping items in a new folder", () => {
  it("puts the folder at their centroid, turned like the station, and moves nothing, as one step", () => {
    for (const [yawDeg, offsetM] of SWEEP) {
      const tourFile = tour(yawDeg, offsetM);
      const start = opened(tourFile);
      const after = reduce(start, group(["p", "q"]));
      expect(after.past).toHaveLength(start.past.length + 1);
      expect(objectOf(after, "p").folder).toEqual(["grp"]);
      expect(objectOf(after, "q").folder).toEqual(["grp"]);
      expectNothingMoved(start, after);
      const out = saved(after);
      const made = folderIn(out, "grp");
      expect(made?.title).toBe("Benches");
      expect(made?.children.map((c) => c.id)).toEqual(["p", "q"]);
      // p at (1, 0, 2) and q at (3, 0, -2) in the station: centroid (2, 0, 0).
      const pose = made?.pose;
      expect(pose?.rotation).toEqual([0, 0, 0, 1]);
      for (const [i, v] of [2, 0, 0].entries()) {
        expect(Math.abs((pose?.position[i] ?? NaN) - v)).toBeLessThanOrEqual(
          1e-6,
        );
      }
      expect(wellChildren(out)).toEqual([
        "miller",
        "outer",
        "spare",
        "grp",
        "r",
      ]);
      expect(saved(reduce(after, act.undone()))).toEqual(saved(start));
    }
  });

  it("refuses a story, an unknown id, two stations, an item already in a folder, a taken id and a title the format refuses", () => {
    const start = opened(tour());
    expect(groupRefusal(start, [])).toBe("notHere");
    expect(groupRefusal(start, ["p", "miller"])).toBe("notHere");
    expect(groupRefusal(start, ["p", "nope"])).toBe("notHere");
    expect(groupRefusal(start, ["p", "g"])).toBe("notHere");
    expect(groupRefusal(start, ["p", "p"])).toBe("notHere");
    expect(groupRefusal(start, ["p", "a"])).toBe("oneLevel");
    expect(groupRefusal(start, ["b"])).toBe("oneLevel");
    expect(groupRefusal(start, ["p", "q"])).toBeNull();
    for (const action of [
      group([]),
      group(["p", "miller"]),
      group(["p", "g"]),
      group(["p", "a"]),
      group(["p", "q"], "Benches", "r"),
      group(["p", "q"], "Benches", "outer"),
      group(["p", "q"], "   "),
      group(["p", "q"], "x".repeat(81)),
    ]) {
      expect(reduce(start, action)).toBe(start);
    }
  });

  it("comes back from the draft after a reload", () => {
    const tourFile = tour();
    const state = reduce(opened(tourFile), group(["p", "r"]));
    const back = reloaded(state, tourFile);
    expect(documentFrames(back)).toEqual(documentFrames(state));
    expect(saved(back)).toEqual(saved(state));
  });
});

describe("taking a folder apart", () => {
  it("lifts its items and its folders into its holder, each where it stood, as one step", () => {
    for (const [yawDeg, offsetM] of SWEEP) {
      const tourFile = tour(yawDeg, offsetM);
      const start = opened(tourFile);
      const after = reduce(
        start,
        act.folderUngrouped({
          stationId: "well",
          folderId: "outer",
          what: "u",
        }),
      );
      expect(after.past).toHaveLength(start.past.length + 1);
      expect(objectOf(after, "a").folder).toBeUndefined();
      expect(objectOf(after, "b").folder).toEqual(["inner"]);
      expectNothingMoved(start, after);
      const out = saved(after);
      expect(folderIn(out, "outer")).toBeUndefined();
      expect(folderIn(out, "inner")?.children.map((c) => c.id)).toEqual(["b"]);
      expect(wellChildren(out)).toEqual([
        "miller",
        "inner",
        "spare",
        "p",
        "q",
        "r",
        "a",
      ]);
      expect(saved(reduce(after, act.undone()))).toEqual(saved(start));
    }
  });

  // Why: a lifted subfolder must stand where it stood, as a folder of its
  // own: its frame is where its items hang, where the editor puts its
  // gizmo and where a later group move turns it. Its items alone would not
  // show a wrong frame (each item's own pose is written against whatever
  // frame the folder got), so the folder's pose itself is checked, against
  // the outer folder's pose composed with its own, worked out here by hand
  // rather than by the code under test.
  it("puts a lifted subfolder where it stood: the outer folder's pose composed with its own", () => {
    const product = (p: Quat, q: Quat): Quat => [
      p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
      p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
      p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
      p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
    ];
    const rotate = (q: Quat, v: Vec): Vec => {
      const r = product(product(q, [v[0], v[1], v[2], 0]), [
        -q[0],
        -q[1],
        -q[2],
        q[3],
      ]);
      return [r[0], r[1], r[2]];
    };
    const INNER_POSITION: Vec = [0, 0.5, -4];
    const INNER_ROTATION: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    for (const [yawDeg, offsetM] of SWEEP) {
      const after = reduce(
        opened(tour(yawDeg, offsetM)),
        act.folderUngrouped({
          stationId: "well",
          folderId: "outer",
          what: "u",
        }),
      );
      const outerRotation = yaw(yawDeg);
      const turned = rotate(outerRotation, INNER_POSITION);
      const want = {
        position: [offsetM + turned[0], 1 + turned[1], 3 + turned[2]],
        rotation: product(outerRotation, INNER_ROTATION),
      };
      const pose = folderIn(saved(after), "inner")?.pose;
      if (pose === undefined) throw new Error("the lifted folder has no pose");
      for (const i of [0, 1, 2]) {
        expect(
          Math.abs((pose.position[i] ?? NaN) - (want.position[i] ?? NaN)),
        ).toBeLessThanOrEqual(1e-6);
      }
      expect(rotationGap(pose.rotation, want.rotation)).toBeLessThanOrEqual(
        1e-12,
      );
    }
  });

  it("refuses an unknown station or folder, and a story", () => {
    const start = opened(tour());
    for (const [stationId, folderId] of [
      ["nowhere", "outer"],
      ["well", "nothing"],
      ["well", "miller"],
      ["gate", "outer"],
    ] as const) {
      expect(
        reduce(start, act.folderUngrouped({ stationId, folderId, what: "u" })),
      ).toBe(start);
    }
  });

  it("comes back from the draft after a reload, after a group too", () => {
    const tourFile = tour(179, 2000);
    const state = reduce(
      reduce(opened(tourFile), group(["p", "q"])),
      act.folderUngrouped({ stationId: "well", folderId: "outer", what: "u" }),
    );
    const back = reloaded(state, tourFile);
    expect(documentFrames(back)).toEqual(documentFrames(state));
    expect(saved(back)).toEqual(saved(state));
  });
});

describe("moving items into and out of a folder", () => {
  it("keeps each item where it stands in the world, as one step", () => {
    for (const [yawDeg, offsetM] of SWEEP) {
      const start = opened(tour(yawDeg, offsetM));
      const into = reduce(
        start,
        act.objectsFoldered({ ids: ["p", "r"], folderId: "inner", what: "in" }),
      );
      expect(into.past).toHaveLength(start.past.length + 1);
      expect(objectOf(into, "p").folder).toEqual(["outer", "inner"]);
      expectNothingMoved(start, into);
      expect(folderIn(saved(into), "inner")?.children.map((c) => c.id)).toEqual(
        ["b", "p", "r"],
      );
      const out = reduce(
        into,
        act.objectsFoldered({ ids: ["a"], folderId: null, what: "out" }),
      );
      expect(out.past).toHaveLength(into.past.length + 1);
      expect(objectOf(out, "a").folder).toBeUndefined();
      expectNothingMoved(start, out);
      expect(wellChildren(saved(out))).toContain("a");
    }
  });

  it("refuses an unknown item, a folder of another station, a story, and a move that changes no folder", () => {
    const start = opened(tour());
    for (const [ids, folderId] of [
      [["nope"], "outer"],
      [["g"], "outer"],
      [["p"], "miller"],
      [["p"], "nothing"],
      [["a"], "outer"],
      [["p"], null],
    ] as const) {
      expect(
        reduce(
          start,
          act.objectsFoldered({ ids: [...ids], folderId, what: "x" }),
        ),
      ).toBe(start);
    }
  });
});

describe("renaming and deleting a folder", () => {
  it("renames a folder as one step, and refuses a blank, an over-long or the same title", () => {
    const start = opened(tour());
    const after = reduce(
      start,
      act.folderRenamed({
        stationId: "well",
        folderId: "inner",
        title: "  Fountain ",
        what: "rename",
      }),
    );
    expect(after.past).toHaveLength(start.past.length + 1);
    expect(folderIn(saved(after), "inner")?.title).toBe("Fountain");
    expectNothingMoved(start, after);
    for (const title of ["", "  ", "x".repeat(81), "Courtyard"]) {
      expect(
        reduce(
          start,
          act.folderRenamed({
            stationId: "well",
            folderId: "outer",
            title,
            what: "r",
          }),
        ),
      ).toBe(start);
    }
  });

  it("deletes a folder with everything in it as one step, and an undo brings it all back", () => {
    const start = opened(tour());
    const after = reduce(
      start,
      act.folderDeleted({ stationId: "well", folderId: "outer", what: "del" }),
    );
    expect(after.past).toHaveLength(start.past.length + 1);
    const ids = documentObjects(after).map((o) => o.object.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    const out = saved(after);
    expect(folderIn(out, "outer")).toBeUndefined();
    expect(folderIn(out, "inner")).toBeUndefined();
    expect(
      tourObjects(out)
        .map((o) => o.id)
        .sort(),
    ).toEqual(["g", "p", "q", "r"]);
    expect(saved(reduce(after, act.undone()))).toEqual(saved(start));
    expect(
      reduce(
        start,
        act.folderDeleted({
          stationId: "well",
          folderId: "nothing",
          what: "d",
        }),
      ),
    ).toBe(start);
  });

  it("keeps an emptied folder: a folder may be empty", () => {
    const start = opened(tour());
    const after = reduce(
      start,
      act.objectsFoldered({ ids: ["a"], folderId: null, what: "out" }),
    );
    expect(folderIn(saved(after), "outer")?.children.map((c) => c.id)).toEqual([
      "inner",
    ]);
  });
});

describe("what the tree's drag may drop where", () => {
  it("says why a drop is not possible, and lets the rest through", () => {
    const state = opened(tour());
    const refusal = folderDropRefusal.bind(null, state);
    expect(
      refusal({ kind: "story", id: "miller" }, { kind: "folder", id: "outer" }),
    ).toBe("storyIntoFolder");
    expect(
      refusal({ kind: "folder", id: "outer" }, { kind: "story", id: "miller" }),
    ).toBe("folderIntoStory");
    expect(
      refusal({ kind: "folder", id: "outer" }, { kind: "folder", id: "outer" }),
    ).toBe("folderIntoItself");
    expect(
      refusal({ kind: "folder", id: "outer" }, { kind: "folder", id: "inner" }),
    ).toBe("folderIntoItself");
    expect(
      refusal({ kind: "folder", id: "spare" }, { kind: "folder", id: "outer" }),
    ).toBe("oneLevel");
    expect(
      refusal({ kind: "item", id: "g" }, { kind: "folder", id: "outer" }),
    ).toBe("notHere");
    expect(
      refusal({ kind: "item", id: "p" }, { kind: "folder", id: "outer" }),
    ).toBeNull();
    expect(
      refusal({ kind: "folder", id: "spare" }, { kind: "station", id: "well" }),
    ).toBeNull();
    expect(
      refusal({ kind: "story", id: "miller" }, { kind: "station", id: "gate" }),
    ).toBeNull();
  });
});

describe("the visitor", () => {
  it("sees every item of a folder where the editor showed it, after a group, a folder move and items moved in and out", () => {
    // Why: the visitor's world view reads the saved file's free blocks
    // (`presentWorldBlocks`, their poses composed through the folders),
    // not the editor's objects; a writer and a reader that disagreed on a
    // folder's frame would put grouped items elsewhere on the walk.
    for (const [yawDeg, offsetM] of SWEEP) {
      let state = opened(tour(yawDeg, offsetM));
      state = reduce(state, group(["p", "q"]));
      state = reduce(
        state,
        act.folderMoved({
          stationId: "well",
          folderId: "outer",
          pose: { position: [-6, 2, 9], rotation: [...yaw(120)] },
          what: "move",
        }),
      );
      state = reduce(
        state,
        act.objectsFoldered({ ids: ["r"], folderId: "inner", what: "in" }),
      );
      state = reduce(
        state,
        act.objectsFoldered({ ids: ["a"], folderId: null, what: "out" }),
      );
      const shown = new Map(
        documentObjects(state).map((o) => [o.object.id, o.object.geo]),
      );
      const file = saved(state);
      let seen = 0;
      for (const station of file.stations) {
        for (const block of presentWorldBlocks(station, [])) {
          const geo = shown.get(block.id);
          if (geo === undefined) throw new Error(`unknown block ${block.id}`);
          expectSameGeo(itemGeoPose(block.pose, station.geo), geo);
          seen += 1;
        }
      }
      expect(seen).toBe(shown.size);
    }
  });
});
