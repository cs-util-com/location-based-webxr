/**
 * Why these tests matter: Paste copies the editor's clipboard (notes and
 * plain folders) into a station, the station a creator picked. A copy in
 * another station must stand there as its original stands in its own
 * (the station-relative pose kept: the creator placed it relative to the
 * station, not to a point on the globe), every id must be new (ids are
 * unique across the tour), the original must not move, and the whole
 * paste - however many notes and folders - must be ONE undo step that an
 * undo takes back exactly. A paste into the source's own station is the
 * copy Duplicate makes. Anything refused changes nothing at all.
 *
 * Declared tolerances: 1e-6 m per axis of a station-relative position
 * (the geo round trip through degrees), 1e-9 on 1 - |q1.q2| for a
 * rotation. Swept: the target station's heading (0, 90 and 179 degrees)
 * and its distance (100 m and 5 km north), and the folder's yaw.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  localPoseOf,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  type TourFolder,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { presentWorldBlocks } from "./shown-blocks.js";
import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  documentFrames,
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type ClipboardPastePayload,
  type TourDocumentState,
} from "./tour-document.js";

type Quat = [number, number, number, number];
const AT = { lat: 48.52, lon: 9.05, alt: 400 };
const POSITION_TOLERANCE_M = 1e-6;
const ROTATION_TOLERANCE = 1e-9;
const WHEN = "2026-11-22T00:00:00.000Z";

function yaw(deg: number): Quat {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function note(id: string, position: [number, number, number], turn = 0) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `Note ${id}`,
    createdAtIso: "2026-11-01T00:00:00.000Z",
    pose: { position, rotation: yaw(turn) },
  } as const;
}

/** Station "well": a story with entry m1, free notes p and q, and folder
 *  "outer" (turned `folderYaw`) holding note a and folder "inner"
 *  (tilted) holding note b. Station "gate", `northM` north, facing
 *  `gateYaw`: note g. `scales` resize outer and inner. */
function tour(
  gateYaw = 90,
  northM = 100,
  folderYaw = 30,
  scales: {
    readonly outer?: number | undefined;
    readonly inner?: number | undefined;
  } = {},
): TourManifest {
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
          note("p", [3, 0, -2], 20),
          note("q", [-4, 1, 0]),
          {
            id: "outer",
            kind: "folder",
            title: "Courtyard",
            pose: { position: [6, 1, 3], rotation: yaw(folderYaw) },
            ...(scales.outer === undefined ? {} : { scale: scales.outer }),
            children: [
              note("a", [2, 0, 0], 10),
              {
                id: "inner",
                kind: "folder",
                ...(scales.inner === undefined ? {} : { scale: scales.inner }),
                pose: {
                  position: [0, 0.5, -4],
                  rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
                },
                children: [note("b", [1, 2, 3])],
              },
            ],
          },
        ]),
      },
      {
        id: "gate",
        title: "The gate",
        geo: {
          lat: AT.lat + northM / 111_320,
          lon: AT.lon,
          alt: AT.alt + 5,
          rotation: yaw(gateYaw),
        },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        ...stationContent([note("g", [0, 0, 1])]),
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

function stationGeo(state: TourDocumentState, id: string) {
  const frame = documentFrames(state).find((f) => f.id === id);
  if (frame === undefined) throw new Error(`no station ${id}`);
  return frame.geo;
}

/** Where `id` stands in the frame of its station `stationId`. */
function localOf(state: TourDocumentState, id: string, stationId: string) {
  return localPoseOf(objectOf(state, id).geo, stationGeo(state, stationId));
}

function rotationGap(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    (a[0] ?? 0) * (b[0] ?? 0) +
      (a[1] ?? 0) * (b[1] ?? 0) +
      (a[2] ?? 0) * (b[2] ?? 0) +
      (a[3] ?? 1) * (b[3] ?? 1),
  );
  return 1 - Math.min(1, dot);
}

/** `copy` in `to` stands as `original` stands in `from`. */
function expectSameLocal(
  state: TourDocumentState,
  copy: { id: string; station: string },
  original: { id: string; station: string },
  start: TourDocumentState = state,
): void {
  const got = localOf(state, copy.id, copy.station);
  const want = localOf(start, original.id, original.station);
  got.position.forEach((v, i) => {
    expect(Math.abs(v - (want.position[i] ?? NaN))).toBeLessThanOrEqual(
      POSITION_TOLERANCE_M,
    );
  });
  expect(rotationGap(got.rotation, want.rotation)).toBeLessThanOrEqual(
    ROTATION_TOLERANCE,
  );
}

function paste(
  input: Partial<Omit<ClipboardPastePayload, "createdAtIso" | "what">> = {},
) {
  return act.clipboardPasted({
    toStationId: input.toStationId ?? "gate",
    objects: input.objects ?? [],
    folders: input.folders ?? [],
    createdAtIso: WHEN,
    what: "the paste",
  });
}

const OUTER_IDS = { outer: "outer2", inner: "inner2", a: "a2", b: "b2" };
const OUTER = { stationId: "well", folderId: "outer", newIds: OUTER_IDS };

function folderIn(
  manifest: TourManifest,
  stationId: string,
  id: string,
): TourFolder | undefined {
  const walk = (list: readonly unknown[]): TourFolder | undefined => {
    for (const child of list as never[]) {
      if (!isTourFolder(child)) continue;
      const folder: TourFolder = child;
      if (folder.id === id) return folder;
      const inner = walk(folder.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return walk(
    manifest.stations.find((s) => s.id === stationId)?.children ?? [],
  );
}

/** Every item of `before` stands where it stood, in `after`. */
function expectOriginalsKept(
  before: TourDocumentState,
  after: TourDocumentState,
): void {
  for (const { object } of documentObjects(before)) {
    expect(objectOf(after, object.id)).toEqual(object);
  }
}

describe("pasting a note into another station", () => {
  it("copies it under a new id, standing there as it stands in its own station, as one step", () => {
    for (const gateYaw of [0, 90, 179]) {
      for (const northM of [100, 5000]) {
        const start = opened(tour(gateYaw, northM));
        const after = reduce(
          start,
          paste({ objects: [{ id: "p", newId: "p2" }] }),
        );
        expect(after.past).toHaveLength(start.past.length + 1);
        const copy = objectOf(after, "p2");
        expect(copy.station).toBe("gate");
        expect(copy.createdAtIso).toBe(WHEN);
        expect(copy.kind === "shortText" && copy.caption).toBe("Note p copy");
        expectSameLocal(
          after,
          { id: "p2", station: "gate" },
          { id: "p", station: "well" },
        );
        expectOriginalsKept(start, after);
        // The visitor sees the copy where the editor shows it.
        const gate = saved(after).stations.find((s) => s.id === "gate");
        const shown = presentWorldBlocks(gate ?? never(), []).find(
          (b) => b.id === "p2",
        );
        const geo = itemGeoPose(
          shown?.pose ?? never(),
          stationGeo(after, "gate"),
        );
        expect(Math.abs(geo.lat - copy.geo.lat)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(geo.lon - copy.geo.lon)).toBeLessThanOrEqual(1e-9);
        expect(saved(reduce(after, act.undone()))).toEqual(saved(start));
      }
    }
  });

  it("takes a note out of its folder: it stands free in the other station", () => {
    const start = opened(tour());
    const after = reduce(start, paste({ objects: [{ id: "b", newId: "b2" }] }));
    expect(objectOf(after, "b2").folder).toBeUndefined();
    expect(objectOf(after, "b").folder).toEqual(["outer", "inner"]);
    expectSameLocal(
      after,
      { id: "b2", station: "gate" },
      { id: "b", station: "well" },
    );
  });

  // Why: a note in a resized folder is drawn at that folder's scale; out
  // of any folder in another station it would come out larger or smaller
  // than the creator sees it, so that paste is refused (its folder can be
  // copied instead). In its own station it is Duplicate's copy, still in
  // its folder.
  it("refuses a note whose folders resize it, into another station only", () => {
    const start = opened(tour(90, 100, 30, { outer: 2 }));
    expect(reduce(start, paste({ objects: [{ id: "a", newId: "a2" }] }))).toBe(
      start,
    );
    expect(reduce(start, paste({ objects: [{ id: "b", newId: "b2" }] }))).toBe(
      start,
    );
    expect(
      reduce(
        start,
        paste({ toStationId: "well", objects: [{ id: "a", newId: "a2" }] }),
      ),
    ).not.toBe(start);
    // Folders that cancel out (2 x 0.5) draw it at its own size.
    const even = opened(tour(90, 100, 30, { outer: 2, inner: 0.5 }));
    expect(
      reduce(even, paste({ objects: [{ id: "b", newId: "b2" }] })),
    ).not.toBe(even);
  });

  it("into its own station makes the copy Duplicate makes", () => {
    // Why: Paste with the source's station selected must not stack the
    // copy on its original; it is the same copy, beside it, as Duplicate.
    for (const id of ["p", "a"]) {
      const start = opened(tour());
      const pasted = reduce(
        start,
        paste({ toStationId: "well", objects: [{ id, newId: "c1" }] }),
      );
      const duplicated = reduce(
        start,
        act.objectDuplicated({
          id,
          newId: "c1",
          createdAtIso: WHEN,
          what: "the paste",
        }),
      );
      expect(saved(pasted)).toEqual(saved(duplicated));
    }
  });
});

describe("pasting a folder into another station", () => {
  it("copies it with everything in it as the station's last folder, each item standing as before relative to the station", () => {
    for (const folderYaw of [0, 30, 179]) {
      for (const gateYaw of [0, 90]) {
        const start = opened(tour(gateYaw, 100, folderYaw));
        const after = reduce(start, paste({ folders: [OUTER] }));
        expect(after.past).toHaveLength(start.past.length + 1);
        const out = saved(after);
        const gate = out.stations.find((s) => s.id === "gate");
        // The last of its folders (the write places its free notes).
        expect(gate?.children.filter(isTourFolder).at(-1)?.id).toBe("outer2");
        const copy = folderIn(out, "gate", "outer2");
        expect(copy?.title).toBe("Courtyard copy");
        expect(folderIn(out, "gate", "inner2")?.title).toBeUndefined();
        expect(objectOf(after, "a2").folder).toEqual(["outer2"]);
        expect(objectOf(after, "b2").folder).toEqual(["outer2", "inner2"]);
        for (const id of ["a", "b"]) {
          expect(objectOf(after, `${id}2`).station).toBe("gate");
          expectSameLocal(
            after,
            { id: `${id}2`, station: "gate" },
            { id, station: "well" },
          );
        }
        expectOriginalsKept(start, after);
        // Read back from the file, the copies stand where the editor
        // shows them.
        const reopened = opened(out);
        for (const id of ["a2", "b2"]) {
          expectSameLocal(
            reopened,
            { id, station: "gate" },
            { id, station: "gate" },
            after,
          );
        }
        expect(saved(reduce(after, act.undone()))).toEqual(saved(start));
      }
    }
  });

  it("copies a nested folder as a folder of the station itself", () => {
    const start = opened(tour());
    const after = reduce(
      start,
      paste({
        folders: [
          {
            stationId: "well",
            folderId: "inner",
            newIds: { inner: "inner2", b: "b2" },
          },
        ],
      }),
    );
    const gate = saved(after).stations.find((s) => s.id === "gate");
    expect(gate?.children.filter(isTourFolder).at(-1)?.id).toBe("inner2");
    expect(objectOf(after, "b2").folder).toEqual(["inner2"]);
    expectSameLocal(
      after,
      { id: "b2", station: "gate" },
      { id: "b", station: "well" },
    );
  });

  // Why: a folder inside a resized folder draws what it holds at the
  // product of the scales around it. Pasted alone into another station it
  // has no folder around it, so it must take that product as its own
  // scale, or every item in it moves and changes size.
  it("gives a nested folder the scale of the folders around it, so what it holds keeps its place and size", () => {
    for (const outer of [0.5, 2]) {
      for (const inner of [undefined, 1.5]) {
        const start = opened(tour(90, 100, 30, { outer, inner }));
        const after = reduce(
          start,
          paste({
            folders: [
              {
                stationId: "well",
                folderId: "inner",
                newIds: { inner: "inner2", b: "b2" },
              },
            ],
          }),
        );
        expect(after).not.toBe(start);
        expect(folderIn(saved(after), "gate", "inner2")?.scale).toBeCloseTo(
          outer * (inner ?? 1),
          12,
        );
        expectSameLocal(
          after,
          { id: "b2", station: "gate" },
          { id: "b", station: "well" },
        );
      }
    }
  });

  it("refuses a nested folder whose folders around it make a scale the format does not allow", () => {
    // 10 x 2 = 20, past the format's 10.
    const start = opened(tour(90, 100, 30, { outer: 10, inner: 2 }));
    expect(
      reduce(
        start,
        paste({
          folders: [
            {
              stationId: "well",
              folderId: "inner",
              newIds: { inner: "inner2", b: "b2" },
            },
          ],
        }),
      ),
    ).toBe(start);
  });

  it("into its own station makes the copy Duplicate makes", () => {
    const start = opened(tour());
    const pasted = reduce(
      start,
      paste({ toStationId: "well", folders: [OUTER] }),
    );
    const duplicated = reduce(
      start,
      act.folderDuplicated({ ...OUTER, createdAtIso: WHEN, what: "the paste" }),
    );
    expect(saved(pasted)).toEqual(saved(duplicated));
  });
});

describe("pasting several at once", () => {
  it("is one undo step that undo and redo take back and give again exactly", () => {
    const start = opened(tour());
    const after = reduce(
      start,
      paste({
        objects: [
          { id: "p", newId: "p2" },
          { id: "q", newId: "q2" },
        ],
        folders: [OUTER],
      }),
    );
    expect(after.past).toHaveLength(start.past.length + 1);
    expect(after.past.at(-1)?.what).toBe("the paste");
    for (const id of ["p2", "q2", "a2", "b2"]) {
      expect(objectOf(after, id).station).toBe("gate");
    }
    const undone = reduce(after, act.undone());
    expect(saved(undone)).toEqual(saved(start));
    expect(documentObjects(undone).map((o) => o.object)).toEqual(
      documentObjects(start).map((o) => o.object),
    );
    const redone = reduce(undone, act.redone());
    expect(saved(redone)).toEqual(saved(after));
  });
});

describe("a paste that is refused", () => {
  // Why: a paste is all or nothing - half a paste would leave the
  // creator a tour that is neither the one before nor the one asked for.
  const refusals: [string, ReturnType<typeof paste>][] = [
    ["nothing to paste", paste()],
    [
      "an unknown station",
      paste({ toStationId: "nowhere", objects: [{ id: "p", newId: "p2" }] }),
    ],
    ["an unknown note", paste({ objects: [{ id: "nope", newId: "p2" }] })],
    ["an unknown folder", paste({ folders: [{ ...OUTER, folderId: "nope" }] })],
    ["a story's entry", paste({ objects: [{ id: "m1", newId: "m2" }] })],
    [
      "a new id already taken, after a good copy",
      paste({
        objects: [
          { id: "p", newId: "p2" },
          { id: "q", newId: "g" },
        ],
      }),
    ],
    [
      "the same new id twice",
      paste({
        objects: [
          { id: "p", newId: "x1" },
          { id: "q", newId: "x1" },
        ],
      }),
    ],
    [
      "a note named twice",
      paste({
        objects: [
          { id: "p", newId: "x1" },
          { id: "p", newId: "x2" },
        ],
      }),
    ],
    [
      "a folder whose new ids miss one of its items",
      paste({
        folders: [{ ...OUTER, newIds: { outer: "o2", inner: "i2", a: "a2" } }],
      }),
    ],
    [
      "a folder new id a note of the same paste took",
      paste({
        objects: [{ id: "p", newId: "a2" }],
        folders: [OUTER],
      }),
    ],
  ];
  for (const [why, action] of refusals) {
    it(`changes nothing for ${why}`, () => {
      const start = opened(tour());
      expect(reduce(start, action)).toBe(start);
    });
  }

  it("changes nothing with no tour open", () => {
    expect(
      reduce(
        initialTourDocumentState,
        paste({ objects: [{ id: "p", newId: "p2" }] }),
      ),
    ).toBe(initialTourDocumentState);
  });
});

function never(): never {
  throw new Error("missing");
}
