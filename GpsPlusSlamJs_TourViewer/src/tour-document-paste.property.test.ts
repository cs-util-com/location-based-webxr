/**
 * Why these tests matter: Paste is a pure document transform the creator
 * may repeat in any order - copy a folder, paste it into three stations,
 * paste a copy of the copy. Over any such sequence every id must stay
 * unique (a copy that reused one would make two items one), every item
 * must name only folders its station holds, each paste must be exactly
 * one undo step, every copy pasted into another station must stand there
 * as its original stands in its own (a folder's resize kept with it), and
 * undoing them all must give back the tour as opened.
 * Example tests (`tour-document-paste.test.ts`) pin single cases; these
 * run random sequences over random station headings and folder turns.
 *
 * Swept: station headings and folder yaw 0-359 degrees, the folder's
 * scale none, 0.5 or 2, sequences of up to 6 pastes of up to 3 sources
 * each, 40 runs.
 */
import fc from "fast-check";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { composedTourFolderScale } from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import {
  localPoseOf,
  tourObjects,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { stationContent } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import { folderChainOf, folderChains } from "./tour-content.js";
import {
  documentFrames,
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };

function turn(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function pinAt(id: string, x: number, z: number) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: id,
    createdAtIso: "2026-11-02T00:00:00.000Z",
    pose: { position: [x, 0, z], rotation: [0, 0, 0, 1] },
  } as const;
}

/** Three stations along the east, headings `heads`; station s0 holds
 *  note n0 and folder f0 (turned `folderDeg`, resized by `scale`) with
 *  note n1 in it. */
function threeStations(
  heads: readonly number[],
  folderDeg: number,
  scale: number | undefined,
) {
  const wire = tourOf([], {
    stations: heads.map((head, i) => ({
      id: `s${String(i)}`,
      title: `Station ${String(i)}`,
      geo: {
        lat: AT.lat,
        lon: AT.lon + i * 0.002,
        alt: AT.alt,
        rotation: turn(head),
      },
      activateRadiusM: 40,
      foundRadiusM: 20,
      hint: "arrow",
      ...stationContent(
        i === 0
          ? [
              pinAt("n0", 2, -1),
              {
                id: "f0",
                kind: "folder",
                title: "Benches",
                pose: { position: [4, 0, 4], rotation: turn(folderDeg) },
                ...(scale === undefined ? {} : { scale }),
                children: [pinAt("n1", 1, 1)],
              },
            ]
          : [pinAt(`e${String(i)}`, 0, 1)],
      ),
    })),
  });
  return parseTourManifest(JSON.parse(serializeTourManifest(wire)));
}

function folderIdsOf(children: readonly TourStationChild[]): string[] {
  return children
    .filter(isTourFolder)
    .flatMap((f) => [f.id, ...folderIdsOf(f.children)]);
}

/** Every id of the saved tour unique, and every item naming only folders
 *  its own station holds. */
function expectWellFormed(state: TourDocumentState): void {
  const out = manifestToWrite(state);
  if (out === null) throw new Error("nothing open");
  const reread: TourManifest = parseTourManifest(
    JSON.parse(serializeTourManifest(out)),
  );
  const ids = [
    ...reread.stations.flatMap((s) => folderIdsOf(s.children)),
    ...tourObjects(reread).map((o) => o.id),
  ];
  expect(new Set(ids).size).toBe(ids.length);
  const foldersOf = new Map(
    documentFrames(state).map((f) => [f.id, new Set(folderIdsOf(f.children))]),
  );
  for (const { object } of documentObjects(state)) {
    for (const folder of object.folder ?? []) {
      expect(foldersOf.get(object.station ?? "")?.has(folder)).toBe(true);
    }
  }
}

/** Where note `id` stands in its station's frame. */
function localOf(state: TourDocumentState, id: string) {
  const found = documentObjects(state).find((o) => o.object.id === id);
  const frame = documentFrames(state).find(
    (f) => f.id === found?.object.station,
  );
  if (found === undefined || frame === undefined) throw new Error(id);
  return localPoseOf(found.object.geo, frame.geo);
}

/** The scale note `id`'s folders draw it at. */
function scaleOf(state: TourDocumentState, id: string): number {
  const found = documentObjects(state).find((o) => o.object.id === id);
  const frame = documentFrames(state).find(
    (f) => f.id === found?.object.station,
  );
  if (found === undefined || frame === undefined) throw new Error(id);
  return composedTourFolderScale(
    folderChainOf(found.object, folderChains(frame)),
  );
}

/** What one paste takes: sources by their index among the tour's notes
 *  and plain folders now, and the station by its index. */
interface PasteOp {
  readonly sources: readonly number[];
  readonly to: number;
}

const pasteOp: fc.Arbitrary<PasteOp> = fc.record({
  sources: fc.uniqueArray(fc.nat({ max: 40 }), { minLength: 1, maxLength: 3 }),
  to: fc.nat({ max: 2 }),
});

describe("any sequence of pastes", () => {
  it("keeps ids unique and folders known, is one step each, and undoes back to the open", () => {
    // Counted so the property cannot pass on pastes that were all refused.
    let tried = 0;
    let applied = 0;
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 359 }), {
          minLength: 3,
          maxLength: 3,
        }),
        fc.integer({ min: 0, max: 359 }),
        fc.constantFrom(undefined, 0.5, 2),
        fc.array(pasteOp, { minLength: 1, maxLength: 6 }),
        (heads, folderDeg, scale, ops) => {
          const start = reduce(
            initialTourDocumentState,
            act.opened({ manifest: threeStations(heads, folderDeg, scale) }),
          );
          let state = start;
          let minted = 0;
          const mint = () => `pc${String((minted += 1))}`;
          for (const op of ops) {
            const notes = documentObjects(state).map((o) => o.object);
            const folders = documentFrames(state).flatMap((f) =>
              folderIdsOf(f.children).map((id) => ({ station: f.id, id })),
            );
            const pool = [
              ...notes.map((n) => ({ kind: "note" as const, id: n.id })),
              ...folders.map((f) => ({ kind: "folder" as const, ...f })),
            ];
            const picked = [
              ...new Map(
                op.sources.map((i) => {
                  const s = pool[i % pool.length];
                  if (s === undefined) throw new Error("empty pool");
                  return [s.id, s] as const;
                }),
              ).values(),
            ];
            const to = `s${String(op.to)}`;
            const stationOf = (id: string) =>
              notes.find((n) => n.id === id)?.station;
            const objects = picked.flatMap((s) =>
              s.kind === "note" ? [{ id: s.id, newId: mint() }] : [],
            );
            // A note its folders resize keeps its size only in its station.
            const refusable = objects.some(
              (o) =>
                stationOf(o.id) !== to &&
                Math.abs(scaleOf(state, o.id) - 1) > 1e-9,
            );
            const action = act.clipboardPasted({
              toStationId: to,
              objects,
              folders: picked.flatMap((s) => {
                if (s.kind !== "folder") return [];
                const frame = documentFrames(state).find(
                  (f) => f.id === s.station,
                );
                const held = notes
                  .filter((n) => n.folder?.includes(s.id) === true)
                  .map((n) => n.id);
                const nested = folderIdsOf(frame?.children ?? []).filter(
                  (id) =>
                    id === s.id || isInside(frame?.children ?? [], s.id, id),
                );
                return [
                  {
                    stationId: s.station,
                    folderId: s.id,
                    newIds: Object.fromEntries(
                      [...nested, ...held].map((id) => [id, mint()]),
                    ),
                  },
                ];
              }),
              createdAtIso: "2026-11-22T00:00:00.000Z",
              what: "a paste",
            });
            const next = reduce(state, action);
            // A refusable op leaves the state as it was.
            expect(refusable && next !== state).toBe(false);
            if (!refusable) tried += 1;
            if (next !== state) applied += 1;
            expect(next.past.length - state.past.length).toBe(
              next === state ? 0 : 1,
            );
            // Every copy into another station: its pose in the station's
            // frame kept. (Into its own, it is Duplicate's offset copy.)
            const copies =
              next === state
                ? []
                : [
                    ...action.payload.objects.map(
                      (o) => [o.newId, o.id] as const,
                    ),
                    ...action.payload.folders.flatMap((f) =>
                      Object.entries(f.newIds)
                        .filter(([id]) => notes.some((n) => n.id === id))
                        .map(([id, newId]) => [newId, id] as const),
                    ),
                  ].filter(([, id]) => stationOf(id) !== to);
            for (const [newId, id] of copies) {
              const got = localOf(next, newId).position;
              const want = localOf(state, id).position;
              got.forEach((v, i) => {
                expect(Math.abs(v - (want[i] ?? NaN))).toBeLessThan(1e-6);
              });
            }
            state = next;
            expectWellFormed(state);
          }
          let undone = state;
          while (undone.position > start.position) {
            undone = reduce(undone, act.undone());
          }
          expect(manifestToWrite(undone)).toEqual(manifestToWrite(start));
        },
      ),
      { numRuns: 40 },
    );
    // Every paste but the refused resized notes lands.
    expect(applied).toBeGreaterThan(tried * 0.9);
  });
});

/** Whether folder `id` sits inside folder `outer` among `children`. */
function isInside(
  children: readonly TourStationChild[],
  outer: string,
  id: string,
): boolean {
  for (const folder of children.filter(isTourFolder)) {
    if (folder.id === outer) return folderIdsOf(folder.children).includes(id);
    if (isInside(folder.children, outer, id)) return true;
  }
  return false;
}
