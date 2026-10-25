/**
 * Why these tests matter: a station's position, height and heading are what
 * every one of its items is placed by, so a stray drag or key press on a
 * station would move its whole content on site. Stations are therefore
 * locked by default, and the lock is kept where every edit of the tour
 * passes: the editor session. These tests drive the real session with
 * random sequences of every command the editor offers (gizmo drags, keys,
 * the inspector's fields, the tree's buttons and the lock itself) and check
 * that no command moves, lifts or turns a station that was locked when it
 * ran - while the radius, the name, a delete and a copy still work.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { manifestToWrite } from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import {
  createTourViewerStore,
  type TourViewerStore,
} from "../tour-viewer-session.js";
import { stationIdOf, tourOf } from "../test-support/v3-tour.js";
import { createEditorSession } from "./editor-session.js";
import { STATION_LOCKED } from "./editor-view.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, lat: number): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const OBJECTS = [pin("a", 48.52), pin("b", 48.5202), pin("c", 48.5204)];
const STATIONS = OBJECTS.map((o) => stationIdOf(o.id));

async function opened(): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = parseTourManifest(
    JSON.parse(serializeTourManifest(tourOf(OBJECTS))),
  );
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  return { session, manifest };
}

/** A command of the editor, on one of the tour's first stations or items
 *  (a station a copy or a move made is reached by its place in the list). */
type Command =
  | { kind: "lock"; at: number; locked: boolean }
  | {
      kind: "moveStation";
      at: number;
      dLat: number;
      dAlt: number;
      turn: number;
    }
  | { kind: "radius"; at: number; radius: number }
  | { kind: "rename"; at: number; title: string }
  | { kind: "deleteStation"; at: number }
  | { kind: "duplicateStation"; at: number }
  | { kind: "reorder" }
  | { kind: "moveItem"; item: string; dLat: number }
  | { kind: "poseItem"; item: string; dLat: number; newStation: boolean }
  | { kind: "groundItem"; item: string; alt: number }
  | { kind: "removeItem"; item: string }
  | { kind: "addStation"; dLat: number };

const at = fc.integer({ min: 0, max: 5 });
const item = fc.constantFrom("a", "b", "c");
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant("lock" as const),
    at,
    locked: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("moveStation" as const),
    at,
    dLat: fc.double({ min: -0.0005, max: 0.0005, noNaN: true }),
    dAlt: fc.constantFrom(0, 0.1, -1),
    turn: fc.constantFrom(0, 5, -15),
  }),
  fc.record({
    kind: fc.constant("radius" as const),
    at,
    radius: fc.constantFrom(2, 12.5, 40),
  }),
  fc.record({
    kind: fc.constant("rename" as const),
    at,
    title: fc.constantFrom("Gate", ""),
  }),
  fc.record({ kind: fc.constant("deleteStation" as const), at }),
  fc.record({ kind: fc.constant("duplicateStation" as const), at }),
  fc.constant({ kind: "reorder" as const }),
  fc.record({
    kind: fc.constant("moveItem" as const),
    item,
    dLat: fc.double({ min: -0.0005, max: 0.0005, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant("poseItem" as const),
    item,
    dLat: fc.double({ min: -0.0005, max: 0.0005, noNaN: true }),
    newStation: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("groundItem" as const),
    item,
    alt: fc.constantFrom(330, 345),
  }),
  fc.record({ kind: fc.constant("removeItem" as const), item }),
  fc.record({
    kind: fc.constant("addStation" as const),
    dLat: fc.double({ min: -0.0005, max: 0.0005, noNaN: true }),
  }),
);

/** The stations' poses by id, as the tour holds them now. */
function posesOf(store: TourViewerStore): Map<string, string> {
  const tour = manifestToWrite(store.getState().tourDocument);
  return new Map(
    (tour?.stations ?? []).map((s) => [s.id, JSON.stringify(s.geo)]),
  );
}

describe("the station lock", () => {
  // Why a property: the lock must hold against every command and every
  // order of them - a copy, a delete and its undo, a station a move made -
  // not only against the drag a hand-written case thinks of.
  it("no command moves, lifts or turns a station while it is locked (property)", async () => {
    const { session, manifest } = await opened();
    await fc.assert(
      fc.asyncProperty(
        fc.array(command, { maxLength: 30, size: "max" }),
        async (commands) => {
          const store = createTourViewerStore();
          const unlocked = new Set<string>();
          const editor = createEditorSession({
            session,
            manifest,
            levels: new Map(),
            store,
            stationLocked: (id) => !unlocked.has(id),
          });
          const stationAt = (i: number): string | undefined => {
            const tour = manifestToWrite(store.getState().tourDocument);
            const list = tour?.stations ?? [];
            return list[i % Math.max(1, list.length)]?.id;
          };
          // Collected, then asserted once a command: what a locked station's
          // move answered, and the locked stations a command moved.
          const wrongAnswers: unknown[] = [];
          for (const c of commands) {
            const before = posesOf(store);
            const lockedBefore = [...before.keys()].filter(
              (id) => !unlocked.has(id),
            );
            const id = "at" in c ? stationAt(c.at) : undefined;
            const geoOf = (stationId: string) =>
              manifestToWrite(store.getState().tourDocument)?.stations.find(
                (s) => s.id === stationId,
              )?.geo;
            switch (c.kind) {
              case "lock":
                if (id === undefined) break;
                if (c.locked) unlocked.delete(id);
                else unlocked.add(id);
                break;
              case "moveStation": {
                const geo = id === undefined ? undefined : geoOf(id);
                if (id === undefined || geo === undefined) break;
                const outcome = editor.moveStation(id, {
                  ...geo,
                  lat: geo.lat + c.dLat,
                  alt: geo.alt + c.dAlt,
                  headingDeg: ((geo.headingDeg ?? 0) + c.turn + 360) % 360,
                });
                // Refused, in the lock's words or an earlier rule's (a
                // station the tour lists but the session no longer holds
                // is "no longer in this tour"): never moved.
                if (!unlocked.has(id) && outcome.kind !== "refused") {
                  wrongAnswers.push(outcome);
                }
                break;
              }
              case "radius":
                if (id !== undefined) {
                  editor.editStation(id, { foundRadiusM: c.radius });
                }
                break;
              case "rename":
                if (id !== undefined)
                  editor.editStation(id, { title: c.title });
                break;
              case "deleteStation":
                if (id !== undefined) editor.deleteStation(id);
                break;
              case "duplicateStation":
                if (id !== undefined) await editor.duplicateStation(id);
                break;
              case "reorder": {
                const ids = [...before.keys()].reverse();
                editor.reorderStations(ids);
                break;
              }
              case "moveItem": {
                const found = manifestToWrite(store.getState().tourDocument);
                if (found === null) break;
                try {
                  editor.move(c.item, 48.52 + c.dLat, 9.05);
                } catch {
                  // A position nobody can draw: not this property's.
                }
                break;
              }
              case "poseItem":
                editor.pose(
                  c.item,
                  {
                    lat: 48.52 + c.dLat,
                    lon: 9.05,
                    alt: 340,
                    rotation: [0, 0, 0, 1],
                  },
                  { newStation: c.newStation },
                );
                break;
              case "groundItem":
                editor.groundItems([{ id: c.item, alt: c.alt }]);
                break;
              case "removeItem":
                editor.remove(c.item);
                break;
              case "addStation":
                editor.addStation({ lat: 48.52 + c.dLat, lon: 9.05, alt: 340 });
                break;
            }
            const after = posesOf(store);
            // A deleted or emptied station has no pose left to keep.
            const moved = lockedBefore.filter(
              (stationId) =>
                after.has(stationId) &&
                after.get(stationId) !== before.get(stationId),
            );
            expect(moved, `locked stations moved by ${c.kind}`).toEqual([]);
            expect(wrongAnswers).toEqual([]);
          }
        },
      ),
      { numRuns: 150 },
    );
    await session.close();
  });

  it("refuses a locked station's move in words, and moves it once unlocked", async () => {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    let locked = true;
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
      stationLocked: () => locked,
    });
    const id = STATIONS[0] ?? "";
    const geo = manifestToWrite(store.getState().tourDocument)?.stations[0]
      ?.geo;
    if (geo === undefined) throw new Error("no station");
    const moved = { ...geo, lat: geo.lat + 0.0001 };
    const refused = editor.moveStation(id, moved);
    expect(refused).toEqual({ kind: "refused", reason: STATION_LOCKED });
    expect(STATION_LOCKED).toMatch(/locked/);
    expect(editor.changeCount()).toBe(0);
    // The radius, the name, a copy and a delete stay open while locked.
    expect(editor.editStation(id, { foundRadiusM: 20 })).toEqual({
      kind: "edited",
    });
    expect(editor.editStation(id, { title: "Gate" })).toEqual({
      kind: "edited",
    });
    expect(await editor.duplicateStation(id)).toMatchObject({
      kind: "duplicated",
    });
    locked = false;
    expect(editor.moveStation(id, moved)).toEqual({ kind: "moved" });
    expect(
      manifestToWrite(store.getState().tourDocument)?.stations[0]?.geo.lat,
    ).toBe(moved.lat);
    expect(editor.deleteStation(STATIONS[1] ?? "")).toEqual({
      kind: "deleted",
    });
    await session.close();
  });

  it("without a lock rule (the phone, a test) every station moves as before", async () => {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
    });
    const geo = manifestToWrite(store.getState().tourDocument)?.stations[0]
      ?.geo;
    if (geo === undefined) throw new Error("no station");
    expect(
      editor.moveStation(STATIONS[0] ?? "", { ...geo, lat: geo.lat + 0.0001 }),
    ).toEqual({ kind: "moved" });
    await session.close();
  });
});
