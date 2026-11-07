/**
 * Why these tests matter: stories are edited as folders in the tree. Each
 * command is a station's change the draft carries, and a sequence of them
 * with undos in between is what a real session looks like. A command that
 * left a `goto` naming a deleted child, or a draft that came back as
 * something other than the screen, loses a creator's work and shows only
 * when the tour is opened again. These drive the real editor session and
 * the real draft with random sequences, and check that the writer accepts
 * the document after every step and that a draft reload equals it.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStories,
  type TourStory,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import { manifestToWrite } from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  freeLocks,
  memoryDraftStores,
  writtenJson,
} from "../test-support/memory-draft.js";
import { stationContent, storyOf } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import { createEditorDraft } from "./editor-draft.js";
import { createEditorSession } from "./editor-session.js";

beforeAll(() => {
  createTourViewerStore();
});

const K = "local-file:00000000000000000000000000000001";

function pin(id: string, lat: number): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: `pin ${id}`,
    createdAtIso: "2026-10-25T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

const line = (id: string) =>
  ({
    id,
    kind: "shortText",
    view: "card",
    caption: `line ${id}`,
    pose: POSE,
  }) as const;

/** Two stations, the first with a story whose choice leads to its lines. */
function storyTour(): TourManifest {
  const base = tourOf([pin("a", 48.52), pin("b", 48.5203)]);
  return {
    ...base,
    stations: base.stations.map((s, i) =>
      i === 0
        ? {
            ...s,
            ...stationContent([
              storyOf("first", [
                line("l1"),
                {
                  id: "c1",
                  kind: "choice",
                  prompt: "Which way?",
                  options: [
                    { id: "o1", label: "Back", goto: "l1" },
                    { id: "o2", label: "On", goto: "l2" },
                    { id: "o3", label: "Next" },
                  ],
                },
                line("l2"),
              ]),
              { ...line("free"), view: "pin" },
            ]),
          }
        : s,
    ),
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

/** A command on a station, story or child reached by its place in the
 *  list, so one a command made is reached the same way. */
type Command =
  | { kind: "add"; at: number }
  | { kind: "rename"; at: number; title: string }
  | { kind: "delete"; at: number }
  | { kind: "addChild"; at: number; make: "pin" | "longText" }
  | { kind: "deleteChild"; at: number }
  | { kind: "undo" }
  | { kind: "redo" };

const at = fc.integer({ min: 0, max: 7 });
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({ kind: fc.constant("add" as const), at }),
  fc.record({
    kind: fc.constant("rename" as const),
    at,
    title: fc.constantFrom("Renamed", "  spaced ", "", "x".repeat(81)),
  }),
  fc.record({ kind: fc.constant("delete" as const), at }),
  fc.record({
    kind: fc.constant("addChild" as const),
    at,
    make: fc.constantFrom("pin" as const, "longText" as const),
  }),
  fc.record({ kind: fc.constant("deleteChild" as const), at }),
  fc.constant({ kind: "undo" as const }),
  fc.constant({ kind: "redo" as const }),
);

/** The item at `at` of `list`, round the list. */
function round<T>(list: readonly T[], i: number): T | undefined {
  return list[i % Math.max(1, list.length)];
}

function storiesIn(tour: TourManifest | null): TourStory[] {
  return (tour?.stations ?? []).flatMap((s) => tourStories(s));
}

describe("the tree's story commands", () => {
  // Why a property: an add, a delete and their undos interleave in any
  // order; a hand-written case covers the order its author thought of.
  it("keep the tour writable after every step, and a draft reload equals it (property)", async () => {
    const { session, manifest } = await opened();
    await fc.assert(
      fc.asyncProperty(
        fc.array(command, { maxLength: 14, size: "max" }),
        async (commands) => {
          const store = createTourViewerStore();
          const stores = memoryDraftStores();
          const draft = createEditorDraft({
            openStore: stores.open,
            holdLock: freeLocks,
            noBackup: () => undefined,
          });
          await draft.open(K, manifest);
          const editor = createEditorSession({
            session,
            manifest,
            levels: new Map(),
            store,
            draft: draft.writes(),
          });
          const tour = () => manifestToWrite(store.getState().tourDocument);
          for (const c of commands) {
            const stories = storiesIn(tour());
            switch (c.kind) {
              case "add": {
                const station = round(tour()?.stations ?? [], c.at);
                if (station !== undefined) editor.addStory(station.id);
                break;
              }
              case "rename": {
                const story = round(stories, c.at);
                if (story !== undefined) editor.renameStory(story.id, c.title);
                break;
              }
              case "delete": {
                const story = round(stories, c.at);
                if (story !== undefined) editor.deleteStory(story.id);
                break;
              }
              case "addChild": {
                const story = round(stories, c.at);
                if (story !== undefined) editor.addToStory(story.id, c.make);
                break;
              }
              case "deleteChild": {
                const child = round(
                  stories.flatMap((s) => s.children),
                  c.at,
                );
                if (child !== undefined) editor.deleteStoryChild(child.id);
                break;
              }
              case "undo":
                editor.undo();
                break;
              case "redo":
                editor.redo();
                break;
            }
            const now = tour();
            if (now === null) throw new Error(`no tour after ${c.kind}`);
            expect(() =>
              parseTourManifest(JSON.parse(serializeTourManifest(now))),
            ).not.toThrow();
          }
          const before = await writtenJson(
            (await editor.save({ keepScan: false })).blob,
          );
          await draft.idle();
          draft.close();

          const again = createEditorDraft({
            openStore: stores.open,
            holdLock: freeLocks,
            noBackup: () => undefined,
          });
          const { offer } = await again.open(K, manifest);
          const reloaded = createEditorSession({
            session,
            manifest,
            levels: new Map(),
            draft: again.writes(),
          });
          if (offer !== null && offer !== undefined) reloaded.restore(offer);
          const after = await writtenJson(
            (await reloaded.save({ keepScan: false })).blob,
          );
          again.close();
          expect(after.stations).toEqual(before.stations);
        },
      ),
      { numRuns: 40 },
    );
    await session.close();
  });
});

describe("a story's delete", () => {
  // Why: the page's question and toast say what went; these are their numbers.
  it("says how many children went, and how many answers changed", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.deleteStoryChild("l2")).toEqual({
      kind: "deleted",
      answers: 1,
    });
    expect(editor.deleteStory("first")).toEqual({
      kind: "deleted",
      children: 2,
    });
    expect(editor.deleteStoryChild("l1").kind).toBe("refused");
    await session.close();
  });

  // Why: an undo line says what it takes back in the creator's words.
  it("names the story and the new one in the undo line", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const stationId = manifest.stations[0]?.id ?? "";
    expect(editor.addStory(stationId).kind).toBe("added");
    expect(editor.undo()).toMatchObject({ what: 'the new story "Story 2"' });
    await session.close();
  });

  // Why: the inspector's chips and seconds write through this one command;
  // a child that is no block, or the same choice again, must write nothing,
  // or a press on the chip already on would make an undo step of nothing.
  it("sets how a block moves on as one step, and nothing for a choice", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const before = editor.revision();
    expect(editor.setStoryAdvance("l1", { mode: "auto", afterS: 7 }).kind).toBe(
      "edited",
    );
    expect(editor.revision()).toBe(before + 1);
    expect(editor.setStoryAdvance("l1", { mode: "auto", afterS: 7 }).kind).toBe(
      "unchanged",
    );
    expect(editor.revision()).toBe(before + 1);
    expect(editor.setStoryAdvance("c1", { mode: "tap" }).kind).toBe("refused");
    expect(editor.setStoryAdvance("gone", { mode: "tap" }).kind).toBe(
      "refused",
    );
    await session.close();
  });

  it("refuses a title the format cannot carry, in words", async () => {
    const { session, manifest } = await opened();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const refused = editor.renameStory("first", "  ");
    expect(refused.kind).toBe("refused");
    expect(editor.renameStory("first", storyName(manifest))).toEqual({
      kind: "unchanged",
    });
    await session.close();
  });
});

function storyName(manifest: TourManifest): string {
  return storiesIn(manifest)[0]?.title ?? "";
}
