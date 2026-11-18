/**
 * Why these tests matter: a folder's Duplicate mints a new id for the
 * folder and everything in it, its Delete takes everything in it, and a
 * multi-folder Ungroup takes several apart - each ONE undo step. Over any
 * sequence of them the tour must keep every id unique (a copy that reused
 * one would make two items one), no item may name a folder the tour no
 * longer holds, and undoing every step must give back the tour as it was
 * opened, redoing them the tour as they left it. Example tests pin single
 * cases; these run random sequences over random folder poses.
 *
 * Swept: the outer folder's yaw (0-359 degrees) and its offset (0 m to
 * 2 km north), sequences of up to 8 actions, 30 runs.
 */
import fc from "fast-check";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };

function yaw(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function pin(id: string, position: [number, number, number]) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-18T00:00:00.000Z",
    pose: { position, rotation: [0, 0, 0, 1] },
  } as const;
}

/** Station "well": free item p, folder "outer" (turned, offset) holding
 *  item a and folder "inner" holding b; an empty folder "spare". Station
 *  "gate": folder "porch" holding g. */
function tour(yawDeg: number, offsetM: number): TourManifest {
  const station = (id: string, northDeg: number, children: unknown[]) => ({
    id,
    title: id,
    geo: {
      ...AT,
      lat: AT.lat + northDeg,
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow" as const,
    ...stationContent(children as never),
  });
  const wire = tourOf([], {
    stations: [
      station("well", 0, [
        pin("p", [1, 0, 2]),
        {
          id: "outer",
          kind: "folder",
          title: "Courtyard",
          pose: { position: [offsetM, 1, 3], rotation: yaw(yawDeg) },
          children: [
            pin("a", [2, 0, 0]),
            {
              id: "inner",
              kind: "folder",
              pose: { position: [0, 0.5, -4], rotation: yaw(30) },
              children: [pin("b", [1, 2, 3])],
            },
          ],
        },
        { id: "spare", kind: "folder", title: "Spare", children: [] },
      ]),
      station("gate", 0.001, [
        { id: "porch", kind: "folder", children: [pin("g", [0, 0, 1])] },
      ]),
    ],
  });
  return parseTourManifest(JSON.parse(serializeTourManifest(wire)));
}

interface FolderSpot {
  readonly stationId: string;
  readonly folderId: string;
  /** It and the folders inside it, at any depth. */
  readonly folderIds: readonly string[];
}

/** Every folder of the tour as it stands, at any depth, in tree order. */
function foldersOf(state: TourDocumentState): FolderSpot[] {
  const out: FolderSpot[] = [];
  const inside = (children: readonly TourStationChild[]): string[] =>
    children.filter(isTourFolder).flatMap((f) => [f.id, ...inside(f.children)]);
  const walk = (stationId: string, children: readonly TourStationChild[]) => {
    for (const folder of children.filter(isTourFolder)) {
      out.push({
        stationId,
        folderId: folder.id,
        folderIds: [folder.id, ...inside(folder.children)],
      });
      walk(stationId, folder.children);
    }
  };
  for (const station of manifestToWrite(state)?.stations ?? []) {
    walk(station.id, station.children);
  }
  return out;
}

function saved(state: TourDocumentState): unknown {
  const out = manifestToWrite(state);
  if (out === null) throw new Error("nothing open");
  return JSON.parse(serializeTourManifest(out));
}

/** An action picks a folder by an index taken modulo the folders there. */
type Op =
  | { readonly kind: "duplicate"; readonly pick: number }
  | { readonly kind: "delete"; readonly pick: number }
  | { readonly kind: "ungroup"; readonly picks: readonly number[] };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("duplicate" as const),
    pick: fc.nat({ max: 50 }),
  }),
  fc.record({
    kind: fc.constant("delete" as const),
    pick: fc.nat({ max: 50 }),
  }),
  fc.record({
    kind: fc.constant("ungroup" as const),
    picks: fc.uniqueArray(fc.nat({ max: 50 }), { minLength: 1, maxLength: 3 }),
  }),
);

describe("folder duplicate, delete and multi-ungroup over random sequences", () => {
  it("keep ids unique and folders whole, and undo and redo every step exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 359 }),
        fc.constantFrom(0, 25, 2000),
        fc.array(op, { maxLength: 8 }),
        (yawDeg, offsetM, ops) => {
          const start = reduce(
            initialTourDocumentState,
            act.opened({ manifest: tour(yawDeg, offsetM) }),
          );
          let state = start;
          let steps = 0;
          let minted = 0;
          // What a step broke, said at the end in one assertion: a check
          // that only some steps make cannot be an expect of its own.
          const broke: string[] = [];
          for (const o of ops) {
            const folders = foldersOf(state);
            const at = (i: number) => folders[i % folders.length];
            if (folders.length === 0) break;
            let next: TourDocumentState;
            if (o.kind === "duplicate") {
              const spot = at(o.pick);
              if (spot === undefined) break;
              const items = documentObjects(state)
                .map((x) => x.object)
                .filter((x) => x.folder?.includes(spot.folderId) === true);
              const newIds = Object.fromEntries(
                [...spot.folderIds, ...items.map((x) => x.id)].map((id) => {
                  minted += 1;
                  return [id, `copy${String(minted)}`];
                }),
              );
              next = reduce(
                state,
                act.folderDuplicated({
                  stationId: spot.stationId,
                  folderId: spot.folderId,
                  newIds,
                  createdAtIso: "2026-11-18T00:00:00.000Z",
                  what: "copy",
                }),
              );
              if (next !== state) {
                // Exactly the minted ids are new: the copy's folders and
                // items, none of the originals lost.
                const had = new Set(foldersOf(state).map((f) => f.folderId));
                const have = new Set(foldersOf(next).map((f) => f.folderId));
                for (const id of spot.folderIds) {
                  const copy = newIds[id] ?? "";
                  if (had.has(copy) || !have.has(copy)) {
                    broke.push(`copy ${copy} of ${id} not exactly new`);
                  }
                }
                const want = documentObjects(state).length + items.length;
                if (documentObjects(next).length !== want) {
                  broke.push(`duplicate of ${spot.folderId}: item count`);
                }
              }
            } else if (o.kind === "delete") {
              const spot = at(o.pick);
              if (spot === undefined) break;
              next = reduce(
                state,
                act.folderDeleted({
                  stationId: spot.stationId,
                  folderId: spot.folderId,
                  what: "del",
                }),
              );
            } else {
              const picked = [
                ...new Set(o.picks.map((i) => at(i)?.folderId ?? "")),
              ];
              next = reduce(
                state,
                act.folderUngrouped({
                  folders: picked.map((folderId) => ({
                    stationId:
                      folders.find((f) => f.folderId === folderId)?.stationId ??
                      "",
                    folderId,
                  })),
                  what: "ungroup",
                }),
              );
            }
            if (next !== state) {
              steps += 1;
              // One action, one step on the undo stack (8 at most here,
              // far below the history limit).
              if (next.past.length !== state.past.length + 1) {
                broke.push(`${o.kind}: not one undo step`);
              }
            }
            state = next;
            const tourNow = manifestToWrite(state);
            if (tourNow === null) throw new Error("closed");
            const folderIds = foldersOf(state).map((f) => f.folderId);
            const itemIds = tourObjects(tourNow).map((x) => x.id);
            const all = [...folderIds, ...itemIds];
            expect(new Set(all).size).toBe(all.length);
            const known = new Set(folderIds);
            for (const item of tourObjects(tourNow)) {
              for (const id of item.folder ?? []) {
                expect(known.has(id)).toBe(true);
              }
            }
          }
          expect(broke).toEqual([]);
          const end = state;
          let back = end;
          for (let i = 0; i < steps; i += 1) back = reduce(back, act.undone());
          expect(saved(back)).toEqual(saved(start));
          let again = back;
          for (let i = 0; i < steps; i += 1) {
            again = reduce(again, act.redone());
          }
          expect(saved(again)).toEqual(saved(end));
        },
      ),
      { numRuns: 30 },
    );
    // Each run replays up to 8 edits, their undos and redos, and two
    // saves: about 0.1 s, so 30 runs stay well inside the time given.
  }, 30_000);
});
