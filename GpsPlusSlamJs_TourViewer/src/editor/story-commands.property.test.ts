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
  type TourPicture,
  type TourPin,
  type TourObject,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStories,
  type TourStory,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";

import {
  documentObjects,
  manifestToWrite,
  tourDocumentActions,
} from "../tour-document.js";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import {
  freeLocks,
  memoryDraftStores,
  writtenJson,
} from "../test-support/memory-draft.js";
import { stationContent, storyOf } from "../test-support/station-content.js";
import { tourOf } from "../test-support/tour-of.js";
import { withReferencedAssets } from "../tour-content.js";
import { createEditorDraft } from "./editor-draft.js";
import { createEditorSession } from "./editor-session.js";
import type { ChildMoveTo } from "../station-children-moves.js";

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

function photo(id: string, lat: number): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-25T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

/** The image a character shows, an asset of the tour beside the photo's. */
const CUTOUT = {
  id: "cut",
  path: "content/cut.png",
  kind: "image",
  width: 2,
  height: 4,
} as const;

/** An untitled station of the file whose only content is a story with a
 *  character and a quiz: nothing else keeps it, so it is an automatic
 *  station, and deleting its story takes it too. */
const LONE: TourStation = {
  id: "lone",
  geo: { lat: 48.5206, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: "arrow",
  ...stationContent([
    storyOf("aside", [
      {
        id: "guard",
        kind: "character",
        view: "stage",
        pose: POSE,
        name: "The watchman",
        image: "cut",
        caption: "Halt!",
      },
      {
        id: "age",
        kind: "quiz",
        question: "How old?",
        points: 2,
        answer: {
          type: "single",
          options: [
            { id: "q1", label: "Old" },
            { id: "q2", label: "New" },
          ],
          correct: "q1",
        },
      },
    ]),
  ]),
};

/** Stations of a pin, a pin and a photo, the first with a story whose
 *  choice leads to its lines, and the automatic station `LONE`; the tour
 *  carries the photo's image and the character's. */
function storyTour(): TourManifest {
  const base = tourOf(
    [pin("a", 48.52), pin("b", 48.5203), photo("p", 48.5209)],
    // A tour id of its own: a save mints one for a tour without, and two
    // saves would mint two.
    { assets: [CUTOUT], tourId: "0123456789abcdef0123456789abcdef" },
  );
  return {
    ...base,
    stations: [...base.stations, LONE].map((s, i) =>
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
    { path: "content/p.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
    { path: "content/cut.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
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
  | { kind: "addChild"; at: number; make: "shortText" | "longText" }
  | { kind: "deleteChild"; at: number }
  | { kind: "move"; at: number; to: number }
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
    make: fc.constantFrom("shortText" as const, "longText" as const),
  }),
  fc.record({ kind: fc.constant("deleteChild" as const), at }),
  fc.record({ kind: fc.constant("move" as const), at, to: at }),
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
  // Every edit is one step (the revision rises by one), an undo gives back
  // exactly the tour before the edit it takes back and a redo exactly the
  // one after it, and the whole written tour (its assets, the quiz and the
  // character of the automatic station a delete can take) comes back from
  // the draft - so asset safety is checked, not only true by construction.
  it("keep the tour writable after every step, each edit one step an undo takes back exactly, and a draft reload equals it (property)", async () => {
    const { session, manifest } = await opened();
    await expect(
      fc.assert(
        fc.asyncProperty(
          fc.array(command, { maxLength: 14, size: "max" }),
          commandsKeepTheTour(session, manifest),
        ),
        { numRuns: 40 },
      ),
    ).resolves.toBeUndefined();
    await session.close();
    // Each run drives a session, two drafts and two saves: more than the
    // default 5 s once the machine runs other gates.
  }, 30_000);

  // Why: a run the property found (seed 694650037). A story added to the
  // photo's station, the photo moved into it, then the story deleted: the
  // photo goes with its story, and the undo steps still name its image,
  // so the save must keep the image's file for an undo across it.
  it("keep a photo's image after the photo moved into a new story and the story was deleted", async () => {
    const { session, manifest } = await opened();
    // The checks are inside the helper; resolving is the pass.
    const run = commandsKeepTheTour(session, manifest);
    await expect(
      run([
        { kind: "add", at: 2 },
        { kind: "move", at: 7, to: 6 },
        { kind: "delete", at: 4 },
      ]),
    ).resolves.toBeUndefined();
    await session.close();
  }, 30_000);
});

/** Drives `commands` through a fresh editor session and draft, checking
 *  after every step and after a draft reload (the property above). */
function commandsKeepTheTour(session: TourSession, manifest: TourManifest) {
  return async (commands: readonly Command[]): Promise<void> => {
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
    /** The tours before each edit an undo can take back, and before
     *  each undo a redo can take back again. */
    const past: (TourManifest | null)[] = [];
    const future: (TourManifest | null)[] = [];
    /** Whether a move of a station item ran (see `freeByName`). */
    let moved = false;
    for (const c of commands) {
      const stories = storiesIn(tour());
      const was = tour();
      const revision = editor.revision();
      /** An add whose station or story is there: it must be a
       *  step, so a silently refused add cannot pass as a no-op. */
      let mustStep = false;
      switch (c.kind) {
        case "add": {
          const station = round(tour()?.stations ?? [], c.at);
          if (station !== undefined) {
            mustStep = true;
            editor.addStory(station.id);
          }
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
          if (story !== undefined) {
            mustStep = true;
            editor.addToStory(story.id, c.make);
          }
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
        case "move": {
          // Any item or story of any station, to any place of its
          // station: what the format refuses is refused, and what
          // it takes is one step.
          const items = (tour()?.stations ?? []).flatMap((st) =>
            st.children.flatMap((ch) =>
              ch.kind === "story"
                ? [
                    { st, id: ch.id },
                    ...ch.children.map((e) => ({ st, id: e.id })),
                  ]
                : [{ st, id: ch.id }],
            ),
          );
          const item = round(items, c.at);
          if (item === undefined) break;
          const places: ChildMoveTo[] = [
            { place: "free" },
            { place: "stories", index: 0 },
            ...tourStories(item.st).flatMap((story) => [
              { place: "story" as const, story: story.id, index: 0 },
              {
                place: "story" as const,
                story: story.id,
                index: story.children.length,
              },
            ]),
          ];
          const to = round(places, c.to);
          if (to !== undefined) {
            const out = editor.moveChild(item.id, to);
            mustStep = out.kind === "moved";
            if (mustStep) moved = true;
          }
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
      const rose = editor.revision() - revision;
      expect(mustStep ? rose : 1, `${c.kind} refused`).toBe(1);
      // An undo or a redo with nothing to take back is the only
      // command that may leave the revision as it was.
      const owed =
        c.kind === "undo" ? past.length : c.kind === "redo" ? future.length : 0;
      expect({ rose, owed }).toEqual(
        rose === 0 ? { rose: 0, owed: 0 } : { rose: 1, owed },
      );
      let expected: TourManifest | null | undefined = was;
      if (rose === 1 && c.kind === "undo") {
        expected = past.pop();
        future.push(was);
      } else if (rose === 1 && c.kind === "redo") {
        expected = future.pop();
        past.push(was);
      } else if (rose === 1) {
        expected = now;
        past.push(was);
        future.length = 0;
      }
      expect(now).toEqual(expected);
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
    // The draft keeps the tour, not its undo steps: an asset only an undo
    // step still names (`historyAssetIds`) is kept by the first save and
    // not by the reloaded one, which has no step that could bring it back.
    // Compared without those; every asset the tour itself names counts.
    const parse = moved ? freeByName : parseTourManifest;
    const read = (json: Record<string, unknown>) =>
      withReferencedAssets(parse(json));
    expect(read(after)).toEqual(read(before));
    expect(before.assets).toEqual(manifest.assets);
  };
}

/** The written tour `json` with each station's free items by id, for a
 *  run in which a move ran. The format keeps the file's order of a
 *  station's free items (`tour-story.ts.md`), but the editor's draft
 *  records none for them (`tour-document.ts.md`): an item a move took out
 *  of a story comes back from a reload at another place among them, so the
 *  tree lists them in another order after a restore. The stories keep
 *  their order, and everything else is compared as written. */
function freeByName(json: Record<string, unknown>): TourManifest {
  const tour = parseTourManifest(json);
  return {
    ...tour,
    stations: tour.stations.map((station) => ({
      ...station,
      children: [
        ...station.children.filter((c) => c.kind === "story"),
        ...station.children
          .filter((c) => c.kind !== "story")
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ],
    })),
  };
}

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
      stationGone: false,
    });
    expect(editor.deleteStoryChild("l1").kind).toBe("refused");
    await session.close();
  });

  // Why: the page's toast says when a delete took the story's station with
  // it; an untitled station of the file that held only the story is gone,
  // and a word about it is all that tells the creator where it went.
  it("says when the station went with its only story", async () => {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
    });
    const stationIds = () =>
      (manifestToWrite(store.getState().tourDocument)?.stations ?? []).map(
        (s) => s.id,
      );
    expect(stationIds()).toContain("lone");
    expect(editor.deleteStory("aside")).toEqual({
      kind: "deleted",
      children: 2,
      stationGone: true,
    });
    expect(stationIds()).not.toContain("lone");
    expect(editor.undo().kind).toBe("undone");
    expect(stationIds()).toContain("lone");
    await session.close();
  });

  // Why: an undo line says what it takes back in the creator's words, and
  // a new story's name must not repeat one the station already has: a
  // count would name the next story "Story 3" again after the second of
  // three was deleted.
  it('names a new story "New story", numbered only while that name is taken', async () => {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
    });
    const stationId = manifest.stations[0]?.id ?? "";
    const added = () => {
      const out = editor.addStory(stationId);
      if (out.kind !== "added") throw new Error("not added");
      return out.id;
    };
    const titles = () => {
      const station = manifestToWrite(
        store.getState().tourDocument,
      )?.stations.find((s) => s.id === stationId);
      return station === undefined
        ? []
        : tourStories(station).map((s) => s.title);
    };
    added();
    expect(editor.undo()).toMatchObject({ what: 'the new story "New story"' });
    editor.redo();
    const second = added();
    added();
    expect(titles()).toEqual([
      "A story",
      "New story",
      "New story 2",
      "New story 3",
    ]);
    editor.deleteStory(second);
    added();
    expect(titles()).toEqual([
      "A story",
      "New story",
      "New story 3",
      "New story 2",
    ]);
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

describe("a station item's move", () => {
  // Why: the tree's drag and the inspector's Move to write through this;
  // each move is one step the undo takes back, the selection's id stays
  // the item's, and a move the format refuses is said in words, never
  // half made.
  it("moves a free item into a story and out again, one step each, and refuses in words", async () => {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
    });
    const tour = () => manifestToWrite(store.getState().tourDocument);
    const first = () => {
      const station = tour()?.stations[0];
      return station === undefined ? undefined : tourStories(station)[0];
    };
    const before = tour();
    const revision = editor.revision();
    expect(
      editor.moveChild("free", { place: "story", story: "first", index: 0 }),
    ).toEqual({ kind: "moved", answers: 0, floored: false });
    expect(editor.revision()).toBe(revision + 1);
    expect(first()?.children.map((c) => c.id)).toEqual([
      "free",
      "l1",
      "c1",
      "l2",
    ]);
    // Out of the story: the answer that led to l2 now plays on, and its
    // card (a story's view) takes the pin a short text stands free as.
    expect(editor.moveChild("l2", { place: "free" })).toEqual({
      kind: "moved",
      answers: 1,
      floored: true,
    });
    expect(editor.revision()).toBe(revision + 2);
    editor.undo();
    editor.undo();
    expect(tour()).toEqual(before);
    // The same place again is no step.
    expect(
      editor.moveChild("l1", { place: "story", story: "first", index: 0 }),
    ).toEqual({ kind: "unchanged" });
    expect(editor.moveChild("c1", { place: "free" })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("choice") as unknown,
    });
    expect(editor.moveChild("first", { place: "free" })).toEqual({
      kind: "refused",
      reason: expect.stringContaining("story") as unknown,
    });
    expect(editor.moveChild("gone", { place: "free" }).kind).toBe("refused");
    expect(editor.revision()).toBe(revision + 4);
    await session.close();
  });
});

describe("a station item's move, counted and kept", () => {
  /** The session over the story tour, with a draft when `stores` is given. */
  async function editorOver(stores?: ReturnType<typeof memoryDraftStores>) {
    const { session, manifest } = await opened();
    const store = createTourViewerStore();
    const draft =
      stores === undefined
        ? undefined
        : createEditorDraft({
            openStore: stores.open,
            holdLock: freeLocks,
            noBackup: () => undefined,
          });
    await draft?.open(K, manifest);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
      store,
      ...(draft === undefined ? {} : { draft: draft.writes() }),
    });
    return { session, manifest, store, draft, editor };
  }

  // Why: the status line said "2 changes not saved" for
  // one move - the item's object record and its station's frame were each
  // counted. A move is one change, in every direction.
  it("counts one move as one change, into a story and out of one", async () => {
    const { session, editor } = await editorOver();
    editor.moveChild("free", { place: "story", story: "first", index: 0 });
    expect(editor.changeCount()).toBe(1);
    editor.undo();
    expect(editor.changeCount()).toBe(0);
    editor.moveChild("l2", { place: "free" });
    expect(editor.changeCount()).toBe(1);
    // A second move at the same station is still one change: its frame,
    // as two edits of one station's stories count once.
    editor.moveChild("l1", { place: "free" });
    expect(editor.changeCount()).toBe(1);
    await session.close();
  });

  // Why: the refusal named "a picture" for every kind.
  it("names the item's kind when its file is not saved yet", async () => {
    const { session, store, editor } = await editorOver();
    const added = await editor.addFile(new Blob(["tune"]), "tune.mp3");
    if (added.kind !== "added") throw new Error(added.reason);
    const pin = documentObjects(store.getState().tourDocument).find(
      (o) => o.object.id === "free",
    )?.object;
    if (pin === undefined) throw new Error("no free pin");
    store.dispatch(
      tourDocumentActions.placed({
        object: {
          id: "tune",
          kind: "audio",
          view: "card",
          audio: added.asset.id,
          station: pin.station,
          geo: pin.geo,
          createdAtIso: pin.createdAtIso,
        } as unknown as TourObject,
        what: "the sound",
      }),
    );
    const out = editor.moveChild("tune", {
      place: "story",
      story: "first",
      index: 0,
    });
    expect(out).toEqual({
      kind: "refused",
      reason: expect.stringContaining("audio") as unknown,
    });
    expect(JSON.stringify(out)).not.toContain("picture");
    await session.close();
  });

  // Why: a saved free item moved into a story leaves a
  // tombstone for its object record; the draft's offer must call that a
  // change of the station, never "1 deletion" - the creator deleted
  // nothing, and "Add it back?" would read as bringing a deleted item back.
  it("offers a move into a story back from the draft as a change, not a deletion", async () => {
    const stores = memoryDraftStores();
    const first = await editorOver(stores);
    first.editor.moveChild("free", {
      place: "story",
      story: "first",
      index: 0,
    });
    const moved = manifestToWrite(first.store.getState().tourDocument);
    await first.draft?.idle();
    first.draft?.close();
    const again = createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    const { offer } = await again.open(K, first.manifest);
    expect(offer?.text).not.toMatch(/deletion/);
    expect(offer?.text).toMatch(
      /^Unsaved work from this tour is still on this device: 1 change\b/,
    );
    const store = createTourViewerStore();
    const reloaded = createEditorSession({
      session: first.session,
      manifest: first.manifest,
      levels: new Map(),
      store,
      draft: again.writes(),
    });
    if (offer === null || offer === undefined) throw new Error("no offer");
    reloaded.restore(offer);
    expect(manifestToWrite(store.getState().tourDocument)).toEqual(moved);
    again.close();
    await first.session.close();
  });

  it("offers a move out of a story back from the draft as one change", async () => {
    const stores = memoryDraftStores();
    const first = await editorOver(stores);
    first.editor.moveChild("l2", { place: "free" });
    await first.draft?.idle();
    first.draft?.close();
    const again = createEditorDraft({
      openStore: stores.open,
      holdLock: freeLocks,
      noBackup: () => undefined,
    });
    const { offer } = await again.open(K, first.manifest);
    expect(offer?.text).toMatch(
      /^Unsaved work from this tour is still on this device: 1 change\b/,
    );
    again.close();
    await first.session.close();
  });
});
