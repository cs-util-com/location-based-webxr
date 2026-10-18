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

  it("the manifest the state would write is the one the Finish rebuild writes", async () => {
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(OPENED) },
      { path: "content/f.jpg", data: "f" },
    ]);
    const tour = await openTourFile(
      new File([zip], "t.zip", { type: "application/zip" }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          opArb.filter((op) => op.kind !== "save"),
          { maxLength: 15 },
        ),
        async (ops) => {
          const state = ops.reduce(apply, opened);
          const finished = await rebuildFinishedTour({
            tour,
            manifest: manifestNow(state)!,
            placed: state.placed,
            deleted: state.deleted,
            levels: [],
            keepScan: false,
            previous: null,
          });
          expect(
            difference(
              renamed(finished!.written),
              renamed(manifestToWrite(state)!),
            ),
          ).toBeNull();
        },
      ),
      { numRuns: 25 },
    );
    await tour.close();
  });
});
