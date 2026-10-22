/**
 * Why these properties matter: the undo history is over the WHOLE tour
 * document - objects, station frames, the setting and the details - and
 * saves land in the middle of it. Whatever mix of edits, undos, redos and
 * saves a creator makes, an undo followed by a redo must change nothing,
 * undoing everything must give back the tour as opened, and the manifest
 * the state says it would write must be exactly what the real Finish
 * rebuild writes into the zip.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_ITEM_MAX_OFFSET_M } from "gps-plus-slam-app-framework/ar/tour-items";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { rebuildFinishedTour } from "./finish-rebuild.js";
import { stationIdOf, tourOf } from "./test-support/v3-tour.js";
import { openTourFile } from "./tour-session.js";
import {
  documentObjects,
  initialTourDocumentState,
  manifestNow,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  viewOf,
  type TourDocumentState,
  type TourDocumentView,
} from "./tour-document.js";
import { parseSettingsRecord, settingsRecord } from "./tour-document-draft.js";

function pin(id: string, lat: number): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function photo(id: string, lat: number): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

const IDS = ["a", "b", "f"] as const;
const OPENED: TourManifest = tourOf([
  pin("a", 48.52),
  pin("b", 48.5202),
  photo("f", 48.5204),
]);

/** OPENED as an earlier file written while the walk's frames were baked
 *  into the tour: one frame in the photo's station, one a kilometre away
 *  in an automatic walk-1 station only it kept. The framework's reader
 *  ignores the field (it is gone from the format), so this is OPENED with
 *  an empty walk-1 station. */
const WITH_CAPTURES: TourManifest = parseTourManifest({
  ...JSON.parse(serializeTourManifest(OPENED)),
  stations: [
    ...OPENED.stations,
    {
      id: "walk-1",
      geo: { lat: 48.53, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      steps: [],
      items: [],
    },
  ],
  captureSpots: {
    fixes: 3,
    gpsAccuracyMedianM: 4,
    captures: [
      {
        image: "content/f.jpg",
        station: stationIdOf("f"),
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      },
      {
        image: "content/far.jpg",
        station: "walk-1",
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  },
});

type Op =
  | { kind: "edit"; id: string; label: string }
  | { kind: "move"; id: string; dLat: number }
  | { kind: "delete"; id: string }
  | { kind: "place"; id: string }
  | { kind: "station"; id: string; dLat: number }
  | { kind: "setting"; on: boolean }
  | { kind: "details"; title: string }
  | { kind: "rename"; id: string; title: string }
  | { kind: "radius"; id: string; radius: number }
  | { kind: "addStation"; stationId: string; dLat: number }
  | { kind: "deleteStation"; id: string }
  | { kind: "reorder" }
  | { kind: "copyStation"; id: string; copy: string }
  | { kind: "copyItem"; id: string; copy: string }
  | { kind: "ground"; id: string; alt: number }
  | { kind: "ownStation"; id: string; stationId: string }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "save" };

const id = fc.constantFrom(...IDS);
const shift = fc.integer({ min: -20, max: 20 }).map((n) => n * 0.00001);
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("edit" as const),
    id,
    label: fc.constantFrom("one", "two", "pin a"),
  }),
  fc.record({ kind: fc.constant("move" as const), id, dLat: shift }),
  fc.record({ kind: fc.constant("delete" as const), id }),
  fc.record({
    kind: fc.constant("place" as const),
    id: fc.constantFrom("n1", "n2"),
  }),
  fc.record({ kind: fc.constant("station" as const), id, dLat: shift }),
  fc.record({ kind: fc.constant("setting" as const), on: fc.boolean() }),
  fc.record({
    kind: fc.constant("details" as const),
    title: fc.constantFrom("", "Old town", "New"),
  }),
  // The 3D editor's station edits. Copies are of the pins' stations only:
  // a copied photo needs its picture, which the rebuild property does not
  // hold (the session's tests do).
  fc.record({
    kind: fc.constant("rename" as const),
    id,
    title: fc.constantFrom("", "Gate", "Well"),
  }),
  fc.record({
    kind: fc.constant("radius" as const),
    id,
    radius: fc.constantFrom(2, 25, 300),
  }),
  fc.record({
    kind: fc.constant("addStation" as const),
    stationId: fc.constantFrom("s1", "s2"),
    dLat: shift,
  }),
  fc.record({ kind: fc.constant("deleteStation" as const), id }),
  fc.constant({ kind: "reorder" as const }),
  fc.record({
    kind: fc.constant("copyStation" as const),
    id: fc.constantFrom("a", "b"),
    copy: fc.constantFrom("c1", "c2"),
  }),
  fc.record({
    kind: fc.constant("copyItem" as const),
    id: fc.constantFrom("a", "b"),
    copy: fc.constantFrom("d1", "d2"),
  }),
  fc.record({
    kind: fc.constant("ground" as const),
    id,
    alt: fc.constantFrom(398, 400.5),
  }),
  fc.record({
    kind: fc.constant("ownStation" as const),
    id,
    stationId: fc.constantFrom("o1", "o2"),
  }),
  fc.constant({ kind: "undo" as const }),
  fc.constant({ kind: "redo" as const }),
  fc.constant({ kind: "save" as const }),
);

/** `op` as a page dispatches it (a page refuses what has no object). */
function apply(state: TourDocumentState, op: Op): TourDocumentState {
  const current = (oid: string) =>
    documentObjects(state).find((o) => o.object.id === oid)?.object;
  switch (op.kind) {
    case "edit": {
      const object = current(op.id);
      if (object?.kind !== "pin" || object.label === op.label) return state;
      return reduce(
        state,
        act.edited({ object: { ...object, label: op.label }, what: "edit" }),
      );
    }
    case "move": {
      const object = current(op.id);
      if (object === undefined) return state;
      return reduce(
        state,
        act.moved({
          object: {
            ...object,
            geo: { ...object.geo, lat: object.geo.lat + op.dLat },
          },
          what: "move",
        }),
      );
    }
    case "delete":
      return current(op.id) === undefined
        ? state
        : reduce(state, act.deleted({ id: op.id, what: "delete" }));
    case "place":
      return current(op.id) === undefined
        ? reduce(
            state,
            act.placed({ object: pin(op.id, 48.521), what: "place" }),
          )
        : state;
    case "station": {
      const frame = state.stations.find((s) => s.id === stationIdOf(op.id));
      if (frame === undefined) return state;
      return reduce(
        state,
        act.stationMoved({
          stationId: frame.id,
          geo: { ...frame.geo, lat: frame.geo.lat + op.dLat },
          what: "station",
        }),
      );
    }
    case "setting":
      return reduce(
        state,
        act.settingsChanged({ needsNoGps: op.on, what: "setting" }),
      );
    case "details":
      return reduce(
        state,
        act.detailsChanged({
          details: op.title === "" ? {} : { title: op.title },
          what: "details",
        }),
      );
    case "rename":
      return reduce(
        state,
        act.stationEdited({
          stationId: stationIdOf(op.id),
          edit: { title: op.title },
          what: "rename",
        }),
      );
    case "radius":
      return reduce(
        state,
        act.stationEdited({
          stationId: stationIdOf(op.id),
          edit: { foundRadiusM: op.radius },
          what: "radius",
        }),
      );
    case "addStation":
      return reduce(
        state,
        act.stationAdded({
          at: { lat: 48.525 + op.dLat, lon: 9.05, alt: 400 },
          stationId: op.stationId,
          what: "add",
        }),
      );
    case "deleteStation":
      return reduce(
        state,
        act.stationDeleted({ stationId: stationIdOf(op.id), what: "delete" }),
      );
    case "reorder": {
      const order = (manifestNow(state)?.stations ?? [])
        .map((s) => s.id)
        .reverse();
      return reduce(state, act.stationsReordered({ order, what: "reorder" }));
    }
    case "copyStation": {
      const stationId = stationIdOf(op.id);
      const items = documentObjects(state).filter(
        (o) => o.object.station === stationId,
      );
      return reduce(
        state,
        act.stationDuplicated({
          stationId,
          newStationId: op.copy,
          newItemIds: Object.fromEntries(
            items.map((o) => [o.object.id, `${o.object.id}${op.copy}`]),
          ),
          createdAtIso: "2026-10-22T00:00:00.000Z",
          what: "copy",
        }),
      );
    }
    case "copyItem":
      return reduce(
        state,
        act.objectDuplicated({
          id: op.id,
          newId: op.copy,
          createdAtIso: "2026-10-22T00:00:00.000Z",
          what: "copy",
        }),
      );
    case "ground":
      return reduce(
        state,
        act.itemsGrounded({ items: [{ id: op.id, alt: op.alt }], what: "g" }),
      );
    case "ownStation": {
      const object = current(op.id);
      if (object === undefined) return state;
      return reduce(
        state,
        act.moved({
          object,
          newStation: true,
          newStationId: op.stationId,
          what: "own station",
        }),
      );
    }
    case "undo":
      return reduce(state, act.undone());
    case "redo":
      return reduce(state, act.redone());
    case "save": {
      const written = manifestToWrite(state)!;
      return reduce(
        state,
        act.saved({
          generation: state.generation,
          written,
          appliedDeletions: [...state.deleted],
          stationsAtStart: state.stations,
        }),
      );
    }
  }
}

/** A view compared as a page sees it: the objects by id. */
function comparable(view: TourDocumentView): unknown {
  return {
    ...view,
    objects: [...view.objects].sort((x, y) => (x.id < y.id ? -1 : 1)),
  };
}

/** A manifest with the ids of stations the opened tour lacks named by
 *  their order (the automatic rule mints random ones). */
function renamed(manifest: TourManifest): unknown {
  const known = new Set(OPENED.stations.map((s) => s.id));
  const names = new Map<string, string>();
  for (const s of manifest.stations) {
    if (!known.has(s.id)) names.set(s.id, `new-${String(names.size)}`);
  }
  return JSON.parse(
    JSON.stringify(manifest, (_key, value: unknown) =>
      typeof value === "string" ? (names.get(value) ?? value) : value,
    ),
  );
}

/** The two alike but for the micrometres a pose's round trip through
 *  the world moves a number (a local pose read into the world and back);
 *  the path of the first difference otherwise. */
function difference(a: unknown, b: unknown, at = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) ? null : at;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return a === b ? null : at;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const found = difference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${at}.${key}`,
    );
    if (found !== null) return found;
  }
  return null;
}

function expectAlike(a: TourManifest, b: TourManifest): void {
  expect(difference(renamed(a), renamed(b))).toBeNull();
}

const opened = reduce(
  initialTourDocumentState,
  act.opened({ manifest: OPENED }),
);

describe("tour document (properties)", () => {
  it("an undo followed by a redo changes nothing", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const state = ops.reduce(apply, opened);
        fc.pre(state.past.length > 0);
        const back = reduce(reduce(state, act.undone()), act.redone());
        expect(
          difference(comparable(viewOf(back)), comparable(viewOf(state))),
        ).toBeNull();
        expectAlike(manifestToWrite(back)!, manifestToWrite(state)!);
      }),
      { numRuns: 300 },
    );
  });

  it("any sequence of edits, recorded in the draft and restored after a reload, gives back the same document", () => {
    // Why: the draft is the only copy of unsaved work across a reload. Its
    // records (the objects', the deletions, the settings record with the
    // stations whole) must bring back exactly the document they were
    // written from, whatever mix of object and station edits made it.
    const noSave = opArb.filter((op) => op.kind !== "save");
    fc.assert(
      fc.property(fc.array(noSave, { maxLength: 20 }), (ops) => {
        const state = ops.reduce(apply, opened);
        const record = parseSettingsRecord(
          JSON.stringify(settingsRecord(state)),
          OPENED,
        );
        expect(record).toBeDefined();
        const back = reduce(
          opened,
          act.restored({
            objects: state.placed.map((p) => p.object),
            deleted: [...state.deleted],
            needsNoGps: record?.needsNoGps ?? false,
            ...(record?.details === undefined
              ? {}
              : { details: record.details }),
            ...(record?.stations === undefined
              ? {}
              : { stations: record.stations }),
            ...(record?.createdStations === undefined
              ? {}
              : { createdStations: record.createdStations }),
            ...(record?.frames === undefined ? {} : { frames: record.frames }),
            ...(record?.order === undefined ? {} : { order: record.order }),
            ...(record?.deletedStations === undefined
              ? {}
              : { deletedStations: record.deletedStations }),
            what: "restore",
          }),
        );
        expectAlike(manifestToWrite(back)!, manifestToWrite(state)!);
      }),
      { numRuns: 300 },
    );
  });

  it("any sequence followed by undoing everything gives back the tour as opened", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        let state = ops.reduce(apply, opened);
        while (state.past.length > 0) state = reduce(state, act.undone());
        expect(
          difference(comparable(viewOf(state)), comparable(viewOf(opened))),
        ).toBeNull();
        expectAlike(manifestToWrite(state)!, OPENED);
      }),
      { numRuns: 300 },
    );
  });

  it("the manifest the state would write is the one the Finish rebuild writes, for a file with debug camera captures and across a second save", async () => {
    // The r875 milestone review #7: what the page shows as the next write
    // must be what a save writes, for a tour opened from a file that
    // carried debug camera captures (written while the walk's frames were
    // baked into stations; the reader ignores the field, so neither write
    // may carry it) and from one without, and once more after a save landed
    // in the middle - the second write starts from the first one's file.
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(OPENED) },
      { path: "content/f.jpg", data: "f" },
    ]);
    const tour = await openTourFile(
      new File([zip], "t.zip", { type: "application/zip" }),
    );
    const noSave = opArb.filter((op) => op.kind !== "save");
    await fc.assert(
      fc.asyncProperty(
        fc.array(noSave, { maxLength: 12 }),
        fc.array(noSave, { maxLength: 8 }),
        fc.boolean(),
        async (first, second, withSpots) => {
          const start = withSpots
            ? reduce(
                initialTourDocumentState,
                act.opened({ manifest: WITH_CAPTURES }),
              )
            : opened;
          let state = first.reduce(apply, start);
          const one = await rebuildFinishedTour({
            tour,
            manifest: manifestNow(state)!,
            placed: state.placed,
            deleted: state.deleted,
            levels: [],
            keepScan: false,
            previous: null,
          });
          expect(difference(one!.written, manifestToWrite(state)!)).toBeNull();
          expect("captureSpots" in one!.written).toBe(false);
          // Changed expectation: walk-1 was dropped with the captures at
          // the open. The field is gone from the format, so the earlier
          // file's empty walk-1 is a station of the tour like any other,
          // and a write keeps it (it emptied nothing).
          expect(one!.written.stations.some((s) => s.id === "walk-1")).toBe(
            withSpots,
          );
          state = reduce(
            state,
            act.saved({
              generation: state.generation,
              written: one!.written,
              appliedDeletions: [...state.deleted],
              stationsAtStart: state.stations,
            }),
          );
          state = second.reduce(apply, state);
          const two = await rebuildFinishedTour({
            tour,
            manifest: manifestNow(state)!,
            placed: state.placed,
            deleted: state.deleted,
            levels: [],
            keepScan: false,
            previous: { blob: one!.blob },
          });
          expect(difference(two!.written, manifestToWrite(state)!)).toBeNull();
          expect("captureSpots" in two!.written).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
    await tour.close();
  });
});

/** A creator's step as the D33 property drives it: the edits of `opArb`
 *  (no save), undo, redo, and a save written in place (arriving, or
 *  failing after it was built) or downloaded - or an in-place write still
 *  in flight, holding the slot across the steps that follow until it lands
 *  or fails. */
type CrossingOp =
  | Op
  | { kind: "in-place" }
  | { kind: "in-place-failed" }
  | { kind: "download" }
  | { kind: "writing-start" }
  | { kind: "writing-lands" }
  | { kind: "writing-fails" };

const crossingOpArb: fc.Arbitrary<CrossingOp> = fc.oneof(
  opArb.filter((op) => op.kind !== "save"),
  fc.constant({ kind: "undo" as const }),
  fc.constant({ kind: "redo" as const }),
  fc.constant({ kind: "in-place" as const }),
  fc.constant({ kind: "in-place-failed" as const }),
  fc.constant({ kind: "download" as const }),
  fc.constant({ kind: "writing-start" as const }),
  fc.constant({ kind: "writing-lands" as const }),
  fc.constant({ kind: "writing-fails" as const }),
);

describe("tour document (properties): a step across an in-place save (D33)", () => {
  it("a step is due a resave exactly when it undoes an edit the in-place file holds, or redoes one it lacks", () => {
    // Why: the slice decides the crossing by history POSITIONS. This model
    // decides it by the SET of edits each view carries - the file holds the
    // edits of the view it wrote; an edit dropped by a new branch it still
    // holds puts it off the history, where every step crosses. Two
    // formulations, one answer, over any mix of edits, steps and saves -
    // steps taken while an in-place write is in flight included, where the
    // disk ends up holding either view.
    fc.assert(
      fc.property(fc.array(crossingOpArb, { maxLength: 40 }), (ops) => {
        let state = opened;
        let line: number[] = [];
        let pos = 0;
        let next = 0;
        let file: Set<number> | null = null;
        /** The view an in-place write in flight holds; the slot is held
         *  while it is set. */
        let writing: Set<number> | null = null;
        for (const op of ops) {
          if (op.kind === "writing-start") {
            if (writing !== null) continue;
            state = reduce(state, act.saveClaimed({ by: "explicit" }));
            state = reduce(
              state,
              act.saved({
                generation: state.generation,
                written: manifestToWrite(state)!,
                appliedDeletions: [...state.deleted],
                stationsAtStart: state.stations,
                inPlaceAt: state.position,
              }),
            );
            writing = new Set(line.slice(0, pos));
            continue;
          }
          if (op.kind === "writing-lands" || op.kind === "writing-fails") {
            if (writing === null) continue;
            if (op.kind === "writing-lands") {
              state = reduce(
                state,
                act.saveDelivered({ inPlace: true, name: "t.zip" }),
              );
              file = writing;
              state = reduce(state, act.saveReleased({}));
            } else {
              state = reduce(
                state,
                act.saveReleased({ error: "write failed" }),
              );
            }
            writing = null;
            continue;
          }
          if (
            op.kind === "in-place" ||
            op.kind === "in-place-failed" ||
            op.kind === "download"
          ) {
            // One save at a time: a write in flight holds the slot.
            if (writing !== null) continue;
            const written = manifestToWrite(state)!;
            const inPlace = op.kind !== "download";
            state = reduce(
              state,
              act.saved({
                generation: state.generation,
                written,
                appliedDeletions: [...state.deleted],
                stationsAtStart: state.stations,
                ...(inPlace ? { inPlaceAt: state.position } : {}),
              }),
            );
            // The write arrives, or fails and leaves the file as it was.
            state = reduce(
              state,
              op.kind === "in-place-failed"
                ? act.saveReleased({ error: "write failed" })
                : act.saveDelivered({ inPlace, name: "t.zip" }),
            );
            if (op.kind === "in-place") file = new Set(line.slice(0, pos));
            if (op.kind === "download") file = null;
            continue;
          }
          // Each step is read on its own: a claimed save takes the last one's
          // resave on, as the page's resave does (while a write holds the
          // slot, its holder's claim again).
          state =
            writing === null
              ? reduce(
                  reduce(state, act.saveClaimed({ by: "auto" })),
                  act.saveReleased({}),
                )
              : reduce(state, act.saveClaimed({ by: "explicit" }));
          const before = state;
          state =
            op.kind === "undo" || op.kind === "redo"
              ? reduce(state, op.kind === "undo" ? act.undone() : act.redone())
              : apply(state, op);
          const taken = state.revision !== before.revision;
          const onLine = new Set(line);
          const off = (held: Set<number>): boolean =>
            [...held].some((edit) => !onLine.has(edit));
          // While a write is in flight the disk ends up holding the file's
          // view or the write's: a step crossing either is due.
          const views = [file, writing].filter(
            (v): v is Set<number> => v !== null,
          );
          // The model's answer: a step not taken, and an edit, cross nothing.
          let due = false;
          if (taken && op.kind === "undo") {
            const edit = line[pos - 1]!;
            pos -= 1;
            due = views.some((v) => off(v) || v.has(edit));
          } else if (taken && op.kind === "redo") {
            const edit = line[pos]!;
            pos += 1;
            due = views.some((v) => off(v) || !v.has(edit));
          } else if (taken) {
            line = [...line.slice(0, pos), next];
            next += 1;
            pos += 1;
          }
          expect(state.save.resave).toBe(due);
          expect(state.position).toBe(pos);
        }
      }),
      { numRuns: 400 },
    );
  });
});

// --- every object belongs to a station -------------------------------------

/** A spot `north`/`east` m from OPENED's first pin, at 400 m. */
function near(north: number, east: number): TourObject["geo"] {
  const g = calcGpsCoords({ lat: 48.52, lon: 9.05 }, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 400, rotation: [0, 0, 0, 1] };
}

type StationOp =
  | { kind: "place"; id: string; north: number; east: number; own: boolean }
  | { kind: "move"; id: string; north: number; east: number }
  | { kind: "delete"; id: string }
  | { kind: "frame"; id: string; north: number }
  | { kind: "restore"; north: number; east: number; dangling: boolean }
  | { kind: "carry" }
  | { kind: "save" }
  | { kind: "undo" }
  | { kind: "redo" };

/** Metres in 12.5 m steps: inside, on the edge of (25 m) and beyond the
 *  found radius of OPENED's stations, which stand about 22 m apart. */
const metres = fc.integer({ min: -12, max: 12 }).map((n) => n * 12.5);
const anyId = fc.constantFrom("a", "b", "f", "p1", "p2", "p3", "r1");
const stationOpArb: fc.Arbitrary<StationOp> = fc.oneof(
  fc.record({
    kind: fc.constant("place" as const),
    id: fc.constantFrom("p1", "p2", "p3"),
    north: metres,
    east: metres,
    own: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("move" as const),
    id: anyId,
    north: metres,
    east: metres,
  }),
  fc.record({ kind: fc.constant("delete" as const), id: anyId }),
  fc.record({ kind: fc.constant("frame" as const), id: anyId, north: metres }),
  fc.record({
    kind: fc.constant("restore" as const),
    north: metres,
    east: metres,
    dangling: fc.boolean(),
  }),
  fc.constant({ kind: "carry" as const }),
  fc.constant({ kind: "save" as const }),
  fc.constant({ kind: "undo" as const }),
  fc.constant({ kind: "redo" as const }),
);

/** The station ops as the pages dispatch them, every state on the way;
 *  station ids minted in order (as `prepare` would, but repeatable). */
function stationRun(
  ops: readonly StationOp[],
  start: TourDocumentState = opened,
): TourDocumentState[] {
  let minted = 0;
  const mint = (): string => {
    minted += 1;
    return `n${String(minted)}`;
  };
  let state = start;
  const states = [state];
  const current = (oid: string) =>
    documentObjects(state).find((o) => o.object.id === oid)?.object;
  for (const op of ops) {
    switch (op.kind) {
      case "place":
        state = reduce(
          state,
          act.placed({
            object: { ...pin(op.id, 0), geo: near(op.north, op.east) },
            what: "place",
            newStationId: mint(),
            ...(op.own ? { newStation: true } : {}),
          }),
        );
        break;
      case "move": {
        const object = current(op.id);
        if (object === undefined) break;
        state = reduce(
          state,
          act.moved({
            object: { ...object, geo: near(op.north, op.east) },
            what: "move",
            newStationId: mint(),
          }),
        );
        break;
      }
      case "delete":
        state = reduce(state, act.deleted({ id: op.id, what: "delete" }));
        break;
      case "frame": {
        const home = current(op.id)?.station;
        const frame = state.stations.find((s) => s.id === home);
        if (frame === undefined) break;
        state = reduce(
          state,
          act.stationMoved({
            stationId: frame.id,
            geo: { ...frame.geo, ...near(op.north, 0) },
            what: "station",
          }),
        );
        break;
      }
      case "restore":
        // A draft's pin, naming a station the document carries, or one it
        // lacks (a draft kept from another open).
        state = reduce(
          state,
          act.restored({
            objects: [
              {
                ...pin("r1", 0),
                geo: near(op.north, op.east),
                station: op.dangling
                  ? "gone"
                  : (state.stations[0]?.id ?? "gone"),
              },
            ],
            deleted: [],
            newStationIds: [mint()],
            what: "restore",
          }),
        );
        break;
      case "carry": {
        // The page's own objects carried into the tour opened anew.
        const carried = documentObjects(state)
          .filter((o) => !o.hosted)
          .map((o) => o.object);
        state = reduce(state, act.opened({ manifest: start.opened! }));
        states.push(state);
        state = reduce(
          state,
          act.restored({
            objects: carried,
            deleted: [],
            rerun: true,
            newStationIds: carried.map(() => mint()),
            what: "carried",
          }),
        );
        break;
      }
      case "save":
        state = reduce(
          state,
          act.saved({
            generation: state.generation,
            written: manifestToWrite(state)!,
            appliedDeletions: [...state.deleted],
            stationsAtStart: state.stations,
          }),
        );
        break;
      case "undo":
        state = reduce(state, act.undone());
        break;
      case "redo":
        state = reduce(state, act.redone());
        break;
    }
    states.push(state);
  }
  return states;
}

/** The ids of `state`'s EMPTY AUTOMATIC stations: no object names them,
 *  and nothing else keeps them (no title, no steps, no route to them, no
 *  description, no card image naming an image asset - an empty station
 *  holds no photo for one to name). */
function emptyAutomatic(state: TourDocumentState): string[] {
  const named = new Set(documentObjects(state).map((o) => o.object.station));
  const routed = new Set(
    state.stations.flatMap((s) => (s.next === undefined ? [] : [s.next])),
  );
  const imageAssets = new Set(
    (state.written?.assets ?? [])
      .filter((a) => a.kind === "image")
      .map((a) => a.id),
  );
  return state.stations
    .filter(
      (s) =>
        !named.has(s.id) &&
        !routed.has(s.id) &&
        (s.title ?? "").trim() === "" &&
        s.steps.length === 0 &&
        (s.description ?? "").trim() === "" &&
        !(s.image !== undefined && imageAssets.has(s.image)),
    )
    .map((s) => s.id);
}

/** Where `state` breaks the station rule, in words; none when it keeps
 *  it: every object names one of the document's stations (in the frames
 *  and in the tour as it stands), and no emptied automatic station stays. */
function stationRuleBreaches(state: TourDocumentState): string[] {
  const now = new Set(manifestNow(state)!.stations.map((s) => s.id));
  const frames = new Set(state.stations.map((s) => s.id));
  const homeless = documentObjects(state)
    .filter(
      ({ object }) =>
        object.station === undefined ||
        !frames.has(object.station) ||
        !now.has(object.station),
    )
    .map(({ object }) => `${object.id} names ${String(object.station)}`);
  return [
    ...homeless,
    ...emptyAutomatic(state).map((id) => `${id} stays empty`),
  ];
}

/** The ways a station of OPENED is kept or not by its own minor 2 fields:
 *  a description, a card image naming the tour's image asset, a card
 *  image naming its own photo (only `f`'s station has one), or nothing. */
const keeperArb = fc.constantFrom("none", "description", "asset", "own");

/** OPENED with an image asset and `keepers` on its three stations, as the
 *  framework's reader gives it (a pin's station's "own" image, which names
 *  no photo, is dropped by that read). */
function openedWithKeepers(keepers: readonly string[]): TourDocumentState {
  const manifest: TourManifest = {
    ...OPENED,
    assets: [{ id: "art", path: "content/art.png", kind: "image" }],
    stations: OPENED.stations.map((s, i) => {
      const keeper = keepers[i];
      if (keeper === "description") return { ...s, description: "Kept." };
      if (keeper === "asset") return { ...s, image: "art" };
      if (keeper === "own") return { ...s, image: s.items[0]!.id };
      return s;
    }),
  };
  return reduce(
    initialTourDocumentState,
    act.opened({
      manifest: parseTourManifest(
        JSON.parse(serializeTourManifest(manifest)) as unknown,
      ),
    }),
  );
}

describe("tour document (properties): every object belongs to a station", () => {
  it("every object names one of the document's stations, and no emptied automatic station stays", () => {
    // Why: the station an object belongs to is the document's answer from
    // the moment it is placed - the creator's display, the settle, the
    // desktop and the written file all read it. An object naming no
    // station (or one nobody carries) would be lost to a visitor's guide,
    // and an automatic station left empty behind a move or a delete would
    // guide a visitor to nothing. Over any mix of placements (inside, on
    // the edge of and beyond the 25 m found radius, with and without "New
    // station here"), moves, deletes, station moves, restored drafts,
    // carried work, saves, undos and redos.
    fc.assert(
      fc.property(fc.array(stationOpArb, { maxLength: 30 }), (ops) => {
        for (const state of stationRun(ops)) {
          expect(stationRuleBreaches(state)).toEqual([]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a step back to a view whose object stood in a station only that view names puts the object back in it (shrunk counterexamples)", () => {
    // Why (found by the property above, seeds -991391345 and 4246602): a
    // step goes back to a view, and an object of the view the written
    // file also holds counts as the file's own, not pending, when it
    // matches the file's copy. While the view's frames were read without
    // the view's objects, a station only a pending object names (one the
    // rule started) was missing from that reading - and with its station
    // missing, the object's re-assignment counted as no move, the object
    // matched the file's copy in its old station, and the station it
    // stood in in the view was left empty. First: a draft's pin seated in
    // a new station, restored again into the first station, saved, and
    // the restore undone. Second: a pin moved out of its station into a
    // new one, that station moved, undone and redone.
    const back = stationRun([
      { kind: "restore", north: -37.5, east: 137.5, dangling: true },
      { kind: "restore", north: -37.5, east: 137.5, dangling: false },
      { kind: "save" },
      { kind: "undo" },
    ]);
    for (const state of back) expect(stationRuleBreaches(state)).toEqual([]);
    const undone = back.at(-1)!;
    const r1 = documentObjects(undone).find((o) => o.object.id === "r1");
    expect(r1?.object.station).toBe("n1");
    expect(manifestToWrite(undone)!.stations.map((s) => s.id)).toContain("n1");

    const again = stationRun([
      { kind: "move", id: "a", north: 0, east: -37.5 },
      { kind: "frame", id: "a", north: 0 },
      { kind: "undo" },
      { kind: "redo" },
    ]);
    for (const state of again) expect(stationRuleBreaches(state)).toEqual([]);
    const redone = again.at(-1)!;
    const a = documentObjects(redone).find((o) => o.object.id === "a");
    expect(a?.object.station).toBe("n1");
    expect(manifestToWrite(redone)!.stations.map((s) => s.id)).toEqual(
      redone.stations.map((s) => s.id),
    );
  });

  it("a station with a description or a card image asset is never emptied away; an emptied one with neither still goes (G2 build plan M1a)", () => {
    // Why: a description and a card image (format minor 2) are the
    // creator's work on the station, as a title is (G2 build plan
    // 2026-10-21-2247, §4.2.4): no delete or move of its items, no save,
    // undo or redo may take the station with them - neither from the
    // document's frames nor from the file a save writes. A card image of
    // the station's own photo keeps nothing once the station is emptied
    // (the photo has left it), so that station goes like a bare one. Over
    // the same op mix as above, from a tour whose stations carry any mix
    // of the two fields.
    fc.assert(
      fc.property(
        fc.array(keeperArb, { minLength: 3, maxLength: 3 }),
        fc.array(stationOpArb, { maxLength: 30 }),
        (keepers, ops) => {
          const start = openedWithKeepers(keepers);
          const kept = start.stations
            .filter(
              (s) => (s.description ?? "").trim() !== "" || s.image === "art",
            )
            .map((s) => s.id);
          for (const state of stationRun(ops, start)) {
            const frames = state.stations.map((s) => s.id);
            const written = manifestToWrite(state)!.stations.map((s) => s.id);
            for (const id of kept) {
              expect(frames).toContain(id);
              expect(written).toContain(id);
            }
            expect(emptyAutomatic(state)).toEqual([]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("an undo of a placement gives the stations back exactly", () => {
    // Why: a placement that starts a station is ONE step - the pin and its
    // station - so an undo must take both back, and the redo history must
    // not keep a station nothing names.
    fc.assert(
      fc.property(
        fc.array(stationOpArb, { maxLength: 20 }),
        metres,
        metres,
        fc.boolean(),
        (ops, north, east, own) => {
          const before = stationRun(ops).at(-1)!;
          const after = reduce(
            before,
            act.placed({
              object: { ...pin("last", 0), geo: near(north, east) },
              what: "place",
              newStationId: "last-station",
              ...(own ? { newStation: true } : {}),
            }),
          );
          fc.pre(after !== before);
          expect(reduce(after, act.undone()).stations).toEqual(before.stations);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("whatever a station's found radius, a placed and then moved object stands within the format's reach of its station, where it was moved", () => {
    // Why: a found radius has no upper bound (a hand-edited file may carry
    // 50 km), while the format keeps an item within 10 km of its station
    // per axis. Seated by the radius alone, an object stood beyond that
    // reach and every later save failed; a move inside such a radius was
    // dropped without a word. Radii from 1 m to 60 km, spots up to 30 km
    // out on each axis.
    const at = (north: number, east: number): TourObject["geo"] => {
      const g = calcGpsCoords({ lat: 48.6, lon: 9.1 }, [north, 0, east]);
      return { lat: g.lat, lon: g.lon, alt: 400, rotation: [0, 0, 0, 1] };
    };
    const km = fc.integer({ min: -30, max: 30 }).map((n) => n * 1000);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60_000 }),
        km,
        km,
        km,
        km,
        (radius, n1, e1, n2, e2) => {
          const manifest: TourManifest = {
            version: 3,
            minor: 0,
            order: "fixed",
            assets: [],
            stations: [
              {
                id: "big",
                geo: at(0, 0),
                activateRadiusM: radius,
                foundRadiusM: radius,
                hint: "arrow",
                steps: [],
                items: [],
              },
            ],
          };
          let state = reduce(
            initialTourDocumentState,
            act.opened({ manifest }),
          );
          const placed = { ...pin("p", 0), geo: at(n1, e1) };
          state = reduce(
            state,
            act.placed({ object: placed, what: "p", newStationId: "first" }),
          );
          state = reduce(
            state,
            act.moved({
              object: { ...placed, geo: at(n2, e2) },
              what: "m",
              newStationId: "second",
            }),
          );
          const p = documentObjects(state).find(
            (o) => o.object.id === "p",
          )!.object;
          expect(p.geo.lat).toBeCloseTo(at(n2, e2).lat, 7);
          expect(p.geo.lon).toBeCloseTo(at(n2, e2).lon, 7);
          const frame = state.stations.find((f) => f.id === p.station)!;
          for (const v of localPoseOf(p.geo, frame.geo).position) {
            expect(Math.abs(v)).toBeLessThanOrEqual(TOUR_ITEM_MAX_OFFSET_M);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
