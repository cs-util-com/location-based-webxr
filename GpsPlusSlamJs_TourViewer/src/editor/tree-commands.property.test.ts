/**
 * Why these tests matter: the 3D view's tree adds, deletes, copies,
 * reorders and splits stations. A command that left two stations under one
 * id, or a copy that broke the numbering the tree and the visitor read,
 * would give a tour a visitor cannot finish - and only a walk on site would
 * show it. These drive the real editor session with random sequences of
 * the tree's commands, their undos and redos, and check after each one
 * that the stations are numbered 1 to n in the tour's order, no id
 * repeats, and the tour still writes and reads back as a valid file.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { manifestToWrite } from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { stationIdOf, tourOf } from "../test-support/v3-tour.js";
import { createEditorSession } from "./editor-session.js";
import { buildTree } from "./editor-shell/tree-model.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, lat: number): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-25T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const OBJECTS = [
  pin("a", 48.52),
  pin("b", 48.5203),
  pin("c", 48.5206),
  pin("d", 48.5209),
];
const [, B] = OBJECTS.map((o) => stationIdOf(o.id)) as [
  string,
  string,
  string,
  string,
];

/** A tour of four stations, the second with a story (a quiz). */
function storyTour(): TourManifest {
  const base = tourOf(OBJECTS);
  const stories: Record<string, Partial<TourStation>> = {
    [B]: {
      steps: [
        {
          id: "q1",
          advance: { mode: "tap" },
          action: {
            kind: "quiz",
            question: "Which way?",
            points: 1,
            answer: {
              type: "single",
              options: [
                { id: "o1", label: "Left" },
                { id: "o2", label: "Right" },
              ],
              correct: "o1",
            },
          },
        },
      ],
    },
  };
  return {
    ...base,
    stations: base.stations.map((s) => ({ ...s, ...stories[s.id] })),
  };
}

async function opened(): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = parseTourManifest(
    JSON.parse(serializeTourManifest(storyTour())),
  );
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  return { session, manifest };
}

/** A tree command, on a station or an item reached by its place in the
 *  list (a station a command made is reached the same way). */
type Command =
  | { kind: "add"; dLat: number }
  | { kind: "delete"; at: number }
  | { kind: "duplicate"; at: number }
  | { kind: "duplicateItem"; item: string }
  | { kind: "reorder"; at: number; slot: number }
  | { kind: "split"; item: string }
  | { kind: "undo" }
  | { kind: "redo" };

const at = fc.integer({ min: 0, max: 7 });
const item = fc.constantFrom("a", "b", "c", "d");
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant("add" as const),
    dLat: fc.double({ min: -0.001, max: 0.001, noNaN: true }),
  }),
  fc.record({ kind: fc.constant("delete" as const), at }),
  fc.record({ kind: fc.constant("duplicate" as const), at }),
  fc.record({ kind: fc.constant("duplicateItem" as const), item }),
  fc.record({ kind: fc.constant("reorder" as const), at, slot: at }),
  fc.record({ kind: fc.constant("split" as const), item }),
  fc.constant({ kind: "undo" as const }),
  fc.constant({ kind: "redo" as const }),
);

describe("the tree's station commands", () => {
  // Why a property: a delete, a copy and their undos interleave in any
  // order; a hand-written case covers the order its author thought of.
  it("keep the stations numbered 1 to n, each id once, and the tour writable (property)", async () => {
    const { session, manifest } = await opened();
    await fc.assert(
      fc.asyncProperty(
        fc.array(command, { maxLength: 25, size: "max" }),
        async (commands) => {
          const store = createTourViewerStore();
          const editor = createEditorSession({
            session,
            manifest,
            levels: new Map(),
            store,
          });
          const tour = () => manifestToWrite(store.getState().tourDocument);
          const ids = () => (tour()?.stations ?? []).map((s) => s.id);
          const stationAt = (i: number) => {
            const list = ids();
            return list[i % Math.max(1, list.length)];
          };
          for (const c of commands) {
            switch (c.kind) {
              case "add":
                editor.addStation({ lat: 48.52 + c.dLat, lon: 9.05, alt: 340 });
                break;
              case "delete": {
                const id = stationAt(c.at);
                if (id !== undefined) editor.deleteStation(id);
                break;
              }
              case "duplicate": {
                const id = stationAt(c.at);
                if (id !== undefined) await editor.duplicateStation(id);
                break;
              }
              case "duplicateItem":
                await editor.duplicateObject(c.item);
                break;
              case "reorder": {
                const list = ids();
                const from = c.at % Math.max(1, list.length);
                const slot = c.slot % (list.length + 1);
                const order = [...list];
                const [moving] = order.splice(from, 1);
                if (moving === undefined) break;
                order.splice(slot > from ? slot - 1 : slot, 0, moving);
                editor.reorderStations(order);
                break;
              }
              case "split":
                editor.moveToNewStation(c.item);
                break;
              case "undo":
                editor.undo();
                break;
              case "redo":
                editor.redo();
                break;
            }
            const now = tour();
            expect(now, `no tour after ${c.kind}`).not.toBeNull();
            const stations = now?.stations ?? [];
            const carried = new Set(stations.map((s) => s.id));
            expect(carried.size, `a station id twice after ${c.kind}`).toBe(
              stations.length,
            );
            const tree = buildTree({
              stations,
              assets: now?.assets ?? [],
              codes: [],
              view: {
                selected: null,
                openStations: [],
                openSections: { stations: true, codes: true, layers: true },
                hiddenLayers: [],
              },
              layers: [],
            });
            expect(tree.cards.map((card) => card.number)).toEqual(
              stations.map((_, i) => i + 1),
            );
            // Untitled stations are named by their number: no gap, no
            // repeat, whatever was deleted or copied before them.
            const untitled = tree.cards.filter(
              (card) => (stations[card.number - 1]?.title ?? "").trim() === "",
            );
            expect(untitled.map((card) => card.title)).toEqual(
              untitled.map((card) => `Station ${String(card.number)}`),
            );
            // What the save writes reads back.
            const written = now === null ? null : serializeTourManifest(now);
            expect(() => {
              if (written !== null) parseTourManifest(JSON.parse(written));
            }).not.toThrow();
          }
        },
      ),
      { numRuns: 120 },
    );
    await session.close();
  });

  // Why: a station added by "+" or "New station here" used to be titled
  // "Station n" with the number it had when it was added. A reorder or a
  // delete moved it, and the tree then showed two stations under one
  // name - "Station 4" twice - though nobody typed either.
  it("never shows two stations under one name the creator did not type, after any add, reorder and delete (property)", async () => {
    const { session, manifest } = await opened();
    const shaping: fc.Arbitrary<Command> = fc.oneof(
      fc.record({
        kind: fc.constant("add" as const),
        dLat: fc.double({ min: -0.001, max: 0.001, noNaN: true }),
      }),
      fc.record({ kind: fc.constant("delete" as const), at }),
      fc.record({ kind: fc.constant("reorder" as const), at, slot: at }),
      fc.constant({ kind: "undo" as const }),
      fc.constant({ kind: "redo" as const }),
    );
    fc.assert(
      fc.property(
        fc.array(shaping, { maxLength: 20, size: "max" }),
        (commands) => {
          const store = createTourViewerStore();
          const editor = createEditorSession({
            session,
            manifest,
            levels: new Map(),
            store,
          });
          const tour = () => manifestToWrite(store.getState().tourDocument);
          const ids = () => (tour()?.stations ?? []).map((s) => s.id);
          for (const c of commands) {
            const list = ids();
            if (c.kind === "add") {
              editor.addStation({ lat: 48.52 + c.dLat, lon: 9.05, alt: 340 });
            } else if (c.kind === "delete") {
              const id = list[c.at % Math.max(1, list.length)];
              if (id !== undefined) editor.deleteStation(id);
            } else if (c.kind === "reorder") {
              const from = c.at % Math.max(1, list.length);
              const order = [...list];
              const [moving] = order.splice(from, 1);
              if (moving !== undefined) {
                order.splice(c.slot % (order.length + 1), 0, moving);
                editor.reorderStations(order);
              }
            } else if (c.kind === "undo") {
              editor.undo();
            } else if (c.kind === "redo") {
              editor.redo();
            }
            const stations = tour()?.stations ?? [];
            // Nobody types here: every name shown is the tour's own.
            const names = buildTree({
              stations,
              assets: [],
              codes: [],
              view: {
                selected: null,
                openStations: [],
                openSections: { stations: true, codes: true, layers: true },
                hiddenLayers: [],
              },
              layers: [],
            }).cards.map((card) => card.title);
            expect(
              names.filter((name, i) => names.indexOf(name) !== i),
              `a name shown twice after ${c.kind}: ${names.join(", ")}`,
            ).toEqual([]);
          }
        },
      ),
      { numRuns: 120 },
    );
    await session.close();
  });
});
