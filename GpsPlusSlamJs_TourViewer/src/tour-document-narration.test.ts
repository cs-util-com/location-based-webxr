/**
 * Why these tests matter: a narration's voice and its read-along text
 * are files of the tour, not fields of a block - a voice is an asset, a
 * timing an archive entry (`timing/<blockId>.json`). `narrationEdited`
 * changes both as ONE step with the block, so an undo takes the voice and
 * the text back together; one that took only the block back would leave a
 * narration naming a timing the next save no longer writes, or a timing
 * the next save writes that nothing names. And the undo of a timing set
 * before a save must bring back what the file held before it, which the
 * page read once (`previous`) - nothing else knows it.
 */
import type {
  TourAsset,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { tourOf } from "./test-support/tour-of.js";
import {
  changeCount,
  initialTourDocumentState,
  documentObjects,
  manifestToWrite,
  timingChanges,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import { draftableObject } from "./tour-document-draft.js";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ENTRY = "timing/essay.json";
const OLD = '{"old":1}';
const NEW = '{"new":2}';

const VOICE: TourAsset = {
  id: "voice",
  path: "content/voice.mp3",
  kind: "audio",
};
const VOICE2: TourAsset = {
  id: "voice2",
  path: "content/voice2.ogg",
  kind: "audio",
};

const ESSAY = {
  id: "essay",
  kind: "longText",
  view: "reading",
  title: "The mill",
  body: "It turned.",
  createdAtIso: "2026-10-31T00:00:01.000Z",
  geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1], headingDeg: 0 },
  // As the document holds it once opened (the station `tourOf` gives it):
  // an edit names the whole object, so the fixture must match it.
  station: "st-essay",
} as const satisfies TourObject;

const NARRATED: TourObject = {
  ...ESSAY,
  narration: { audio: "voice", timing: ENTRY, synthetic: false },
};

function opened(object: TourObject = NARRATED): TourDocumentState {
  return reduce(
    initialTourDocumentState,
    act.opened({ manifest: tourOf([object], { assets: [VOICE] }) }),
  );
}

function essay(state: TourDocumentState): TourObject | undefined {
  return documentObjects(state).find((o) => o.object.id === "essay")?.object;
}

/** A save of the tour as it stands, landed. */
function savedNow(
  state: TourDocumentState,
  timings?: Record<string, string | null>,
): TourDocumentState {
  const generation = state.generation;
  const written = manifestToWrite(state);
  if (written === null) throw new Error("nothing open");
  let next = reduce(state, act.saveStarted({ generation }));
  next = reduce(
    next,
    act.saved({
      generation,
      written,
      appliedDeletions: [...state.deleted],
      stationsAtStart: state.stations,
      ...(timings === undefined ? {} : { timings }),
    }),
  );
  return reduce(next, act.saveEnded({ generation }));
}

describe("narrationEdited: a voice brought in", () => {
  it("lists the voice with the tour and names it as the text's audio, as one step", () => {
    const before = opened(ESSAY);
    const added = reduce(before, act.assetsAdded({ assets: [VOICE2] }));
    // The file brought in is no step of its own: the edit naming it is.
    expect(added.addedAssets).toEqual([VOICE2]);
    expect(changeCount(added)).toBe(0);
    expect(added.past).toEqual(before.past);
    const state = reduce(
      added,
      act.narrationEdited({
        object: { ...ESSAY, narration: { audio: "voice2", synthetic: false } },
        what: "the voice",
      }),
    );
    expect(manifestToWrite(state)?.assets).toContainEqual(VOICE2);
    expect(essay(state)).toMatchObject({ narration: { audio: "voice2" } });
    expect(changeCount(state)).toBe(1);
    const undone = reduce(state, act.undone());
    expect(essay(undone)).not.toHaveProperty("narration");
    expect(changeCount(undone)).toBe(0);
    // Kept for a redo; a write drops what nothing names.
    expect(undone.addedAssets).toEqual([VOICE2]);
  });

  // Why: the table is one per tour - an asset is listed once, never one
  // the written tour lists, and never one whose path does not say what
  // it is (the format would refuse the next save).
  it("lists an added asset once, and none the tour has or the format refuses", () => {
    const before = opened(ESSAY);
    let state = reduce(before, act.assetsAdded({ assets: [VOICE2, VOICE2] }));
    state = reduce(state, act.assetsAdded({ assets: [VOICE2, VOICE] }));
    expect(state.addedAssets).toEqual([VOICE2]);
    for (const bad of [
      { ...VOICE2, id: "x", kind: "image" as const, path: "content/x.ogg" },
      { ...VOICE2, id: "y", path: "content/z.ogg" },
      { ...VOICE2, id: "w", path: "content/w.txt" },
    ]) {
      expect(reduce(before, act.assetsAdded({ assets: [bad] }))).toBe(before);
    }
  });

  it("refuses a narration naming audio the tour neither holds nor brings in", () => {
    const before = opened(ESSAY);
    expect(
      reduce(
        before,
        act.narrationEdited({
          object: { ...ESSAY, narration: { audio: "ghost", synthetic: false } },
          what: "the voice",
        }),
      ),
    ).toBe(before);
  });

  it("refuses a change of anything but the narration", () => {
    const before = opened();
    expect(
      reduce(
        before,
        act.narrationEdited({
          object: { ...NARRATED, body: "Changed." },
          what: "the voice",
        }),
      ),
    ).toBe(before);
  });
});

describe("narrationEdited: the read-along text", () => {
  const setNew = (state: TourDocumentState, previous: string | null = OLD) =>
    reduce(
      state,
      act.narrationEdited({
        object: NARRATED,
        timing: { entry: ENTRY, text: NEW, previous },
        what: "the timing",
      }),
    );

  it("sets the entry's text as one pending change, and an undo brings back what the file held", () => {
    const state = setNew(opened());
    expect(state.timings).toEqual({ [ENTRY]: NEW });
    expect(state.timingsWritten).toEqual({ [ENTRY]: OLD });
    expect(timingChanges(state)).toBe(1);
    expect(changeCount(state)).toBe(1);
    const undone = reduce(state, act.undone());
    expect(undone.timings).toEqual({ [ENTRY]: OLD });
    expect(changeCount(undone)).toBe(0);
    expect(reduce(undone, act.redone()).timings).toEqual({ [ENTRY]: NEW });
  });

  it("is no step when the text is the one it has", () => {
    const state = setNew(opened());
    expect(setNew(state)).toBe(state);
  });

  it("refuses another block's entry, and a text where the narration names none", () => {
    const before = opened();
    expect(
      reduce(
        before,
        act.narrationEdited({
          object: NARRATED,
          timing: { entry: "timing/other.json", text: NEW, previous: null },
          what: "the timing",
        }),
      ),
    ).toBe(before);
    const { timing: _t, ...voiceOnly } = {
      audio: "voice",
      timing: ENTRY,
      synthetic: false,
    };
    expect(
      reduce(
        before,
        act.narrationEdited({
          object: { ...ESSAY, narration: voiceOnly },
          timing: { entry: ENTRY, text: NEW, previous: OLD },
          what: "the timing",
        }),
      ),
    ).toBe(before);
  });

  it("brings back the text the file held before an earlier save when undone after it", () => {
    // Set, saved (the file now holds NEW), set again, saved; then undone
    // twice: each undo restores what that step started from.
    let state = savedNow(setNew(opened()), { [ENTRY]: NEW });
    expect(state.timingsWritten).toEqual({ [ENTRY]: NEW });
    expect(changeCount(state)).toBe(0);
    state = reduce(
      state,
      act.narrationEdited({
        object: NARRATED,
        timing: { entry: ENTRY, text: '{"third":3}', previous: "ignored" },
        what: "the timing",
      }),
    );
    // Listed already: `previous` is not read again.
    expect(state.timingsWritten).toEqual({ [ENTRY]: NEW });
    state = savedNow(state, { [ENTRY]: '{"third":3}' });
    state = reduce(state, act.undone());
    expect(state.timings[ENTRY]).toBe(NEW);
    state = reduce(state, act.undone());
    expect(state.timings[ENTRY]).toBe(OLD);
    expect(timingChanges(state)).toBe(1);
  });

  it("takes the voice off with its timing in one step, and the undo brings both back", () => {
    const state = reduce(
      opened(),
      act.narrationEdited({
        object: ESSAY,
        timing: { entry: ENTRY, text: null, previous: OLD },
        what: "the removal",
      }),
    );
    expect(essay(state)).not.toHaveProperty("narration");
    expect(state.timings).toEqual({ [ENTRY]: null });
    // The timing no narration names is no change of its own.
    expect(timingChanges(state)).toBe(0);
    expect(changeCount(state)).toBe(1);
    const undone = reduce(state, act.undone());
    expect(essay(undone)).toEqual(NARRATED);
    expect(undone.timings).toEqual({ [ENTRY]: OLD });
    expect(changeCount(undone)).toBe(0);
  });
});

describe("draftableObject: what a draft keeps of a narration", () => {
  // Why: a draft keeps records and the files brought in, never a timing's
  // text. A reload offering a narration that names a timing only this
  // page held would put back a block naming a file the tour lacks, and
  // every later save would fail.
  it("keeps a narration the written file holds whole", () => {
    const state = opened();
    expect(draftableObject(NARRATED, state)).toBe(NARRATED);
  });

  // Why: a voice brought in here is a file of the draft too (written
  // before the record that names it), so its narration is kept.
  it("keeps a narration naming a voice brought in here", () => {
    const state = reduce(
      reduce(opened(ESSAY), act.assetsAdded({ assets: [VOICE2] })),
      act.narrationEdited({
        object: { ...ESSAY, narration: { audio: "voice2", synthetic: false } },
        what: "the voice",
      }),
    );
    const object = essay(state) as TourObject;
    expect(draftableObject(object, state)).toBe(object);
  });

  it("keeps the written narration for a timing the written file does not hold", () => {
    const state = reduce(
      opened({ ...ESSAY, narration: { audio: "voice", synthetic: false } }),
      act.narrationEdited({
        object: NARRATED,
        timing: { entry: ENTRY, text: NEW, previous: null },
        what: "the timing",
      }),
    );
    expect(draftableObject(NARRATED, state)).toEqual({
      ...ESSAY,
      narration: { audio: "voice", synthetic: false },
    });
  });
  // Why: a file brought in whose write did not land (a full disk) is held
  // nowhere after a reload, and a record naming it is then left out whole.
  // That holds for every kind that names a file, not only a narration: a
  // model naming such a file is drafted as the written file has it, and a
  // new one naming it not at all, never as a record naming a missing file.
  it("drafts a model naming a file the draft could not keep as the written file has it, or not at all", () => {
    const STATUE: TourAsset = {
      id: "statue",
      path: "content/statue.glb",
      kind: "model",
    };
    const NEW_STATUE: TourAsset = {
      id: "statue2",
      path: "content/statue2.glb",
      kind: "model",
    };
    const model = {
      id: "m",
      kind: "model",
      view: "placed",
      asset: "statue",
      sizeM: 2,
      createdAtIso: "2026-10-31T00:00:02.000Z",
      geo: {
        lat: 47.5,
        lon: 8.7,
        alt: 400,
        rotation: [0, 0, 0, 1],
        headingDeg: 0,
      },
      station: "st-m",
    } as const satisfies TourObject;
    const state = reduce(
      reduce(
        initialTourDocumentState,
        act.opened({ manifest: tourOf([model], { assets: [STATUE] }) }),
      ),
      act.assetsAdded({ assets: [NEW_STATUE] }),
    );
    const written = documentObjects(state).find(
      (o) => o.object.id === "m",
    )?.object;
    const renamed: TourObject = { ...model, asset: "statue2", sizeM: 3 };
    const notKept = (id: string): boolean => id !== "statue2";
    expect(draftableObject(renamed, state)).toBe(renamed);
    expect(draftableObject(renamed, state, notKept)).toEqual(written);
    expect(
      draftableObject({ ...renamed, id: "m-new" }, state, notKept),
    ).toBeNull();
  });
});
