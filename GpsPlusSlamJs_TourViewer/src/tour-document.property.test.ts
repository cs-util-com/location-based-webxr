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
import {
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { rebuildFinishedTour } from "./finish-rebuild.js";
import type { CaptureSpotsInWorld } from "./tour-content.js";
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

/** The walk's photo spots a save is given: one beside the tour's photo,
 *  one a kilometre away, which the save puts into a station of its own
 *  (an automatic id, minted by the write). */
const SPOTS: CaptureSpotsInWorld = {
  fixes: 3,
  gpsAccuracyMedianM: 4,
  captures: [
    {
      image: "content/f.jpg",
      geo: { lat: 48.5204, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
    },
    {
      image: "content/far.jpg",
      geo: { lat: 48.53, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
    },
  ],
};

const IDS = ["a", "b", "f"] as const;
const OPENED: TourManifest = tourOf([
  pin("a", 48.52),
  pin("b", 48.5202),
  photo("f", 48.5204),
]);

type Op =
  | { kind: "edit"; id: string; label: string }
  | { kind: "move"; id: string; dLat: number }
  | { kind: "delete"; id: string }
  | { kind: "place"; id: string }
  | { kind: "station"; id: string; dLat: number }
  | { kind: "setting"; on: boolean }
  | { kind: "details"; title: string }
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

  it("the manifest the state would write is the one the Finish rebuild writes, with photo spots and across a second save", async () => {
    // The r875 milestone review #7: the selector takes the save's own
    // inputs (the photo spots, decided once per open), so it is checked
    // with them and without, and once more after a save landed in the
    // middle - the second write starts from the first one's file, whose
    // automatic stations the spots minted.
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
          const spots = withSpots ? SPOTS : undefined;
          const extra = spots === undefined ? {} : { captureSpots: spots };
          let state = first.reduce(apply, opened);
          const one = await rebuildFinishedTour({
            tour,
            manifest: manifestNow(state)!,
            placed: state.placed,
            deleted: state.deleted,
            levels: [],
            keepScan: false,
            previous: null,
            ...extra,
          });
          expect(
            difference(
              renamed(one!.written),
              renamed(manifestToWrite(state, spots)!),
            ),
          ).toBeNull();
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
            ...extra,
          });
          expect(
            difference(
              renamed(two!.written),
              renamed(manifestToWrite(state, spots)!),
            ),
          ).toBeNull();
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
