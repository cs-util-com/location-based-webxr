/**
 * Why these tests matter: the 3D inspector writes a model's notes,
 * sections, view and clip through these edits, and the file's reader holds
 * them to the format's caps. A note with no title, a fifth section or a
 * zero normal written here would make the saved tour one the reader
 * refuses, so every refusal is pinned with its words. The default rule
 * (the first note switches a placed model to hotspots, the last note
 * deleted switches it back, an explicit choice is never overridden) is the
 * owner's, and pinned case by case.
 */
import {
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourModel } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import {
  MODEL_EDIT_REFUSALS,
  applyModelEdit,
  type ModelEdit,
  type ModelEditOutcome,
} from "./model-edits.js";

const GEO = { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 };
const MODEL = {
  id: "m",
  kind: "model",
  view: "placed",
  asset: "a",
  sizeM: 2,
  geo: GEO,
} as TourModel;
const AT = { position: [0.1, 0.2, 0.3], normal: [0, 1, 0] } as const;

function after(outcome: ModelEditOutcome): TourModel {
  if (outcome.kind !== "edited") {
    throw new Error(`expected an edit, got ${JSON.stringify(outcome)}`);
  }
  return outcome.after;
}

const run = (model: TourModel, edits: ModelEdit[], explicit = false) =>
  edits.reduce((m, e) => after(applyModelEdit(m, e, explicit)), model);

describe("the default view rule", () => {
  it("switches a placed model to hotspots with its first note", () => {
    const m = run(MODEL, [{ kind: "note-add", at: AT }]);
    expect(m.view).toBe("hotspots");
    expect(m.annotations).toEqual([
      { position: [0.1, 0.2, 0.3], normal: [0, 1, 0], title: "Note 1" },
    ]);
  });

  it("switches it once: a second note keeps the view", () => {
    const m = run(MODEL, [
      { kind: "note-add", at: AT },
      { kind: "view", view: "ghost" },
      { kind: "note-add", at: AT },
    ]);
    expect(m.view).toBe("ghost");
  });

  it("switches it back to placed when its last note is deleted", () => {
    const m = run(MODEL, [
      { kind: "note-add", at: AT },
      { kind: "note-delete", index: 0 },
    ]);
    expect(m.view).toBe("placed");
    expect(m.annotations).toBeUndefined();
  });

  it("keeps a view the creator chose, adding or deleting", () => {
    const m = run(MODEL, [{ kind: "note-add", at: AT }], true);
    expect(m.view).toBe("placed");
    const hot = { ...MODEL, view: "hotspots" } as TourModel;
    const n = run(
      hot,
      [
        { kind: "note-add", at: AT },
        { kind: "note-delete", index: 0 },
      ],
      true,
    );
    expect(n.view).toBe("hotspots");
  });

  it("leaves a model in another view where it is", () => {
    const toy = { ...MODEL, view: "toy" } as TourModel;
    expect(run(toy, [{ kind: "note-add", at: AT }]).view).toBe("toy");
    const two = run(toy, [
      { kind: "note-add", at: AT },
      { kind: "note-add", at: AT },
      { kind: "note-delete", index: 1 },
    ]);
    expect(two.view).toBe("toy");
  });
});

describe("notes", () => {
  const one = run(MODEL, [{ kind: "note-add", at: AT }]);

  it("edits a title and a text, and a blank text removes it", () => {
    const m = run(one, [
      { kind: "note-text", index: 0, field: "title", value: "Clapper" },
      { kind: "note-text", index: 0, field: "text", value: "Cast in 1612." },
    ]);
    expect(m.annotations?.[0]).toMatchObject({
      title: "Clapper",
      text: "Cast in 1612.",
    });
    const gone = run(m, [
      { kind: "note-text", index: 0, field: "text", value: "  " },
    ]);
    expect(gone.annotations?.[0]).not.toHaveProperty("text");
  });

  it("refuses a blank title and one over the cap", () => {
    for (const value of ["", "   ", "x".repeat(65)]) {
      expect(
        applyModelEdit(
          one,
          { kind: "note-text", index: 0, field: "title", value },
          false,
        ),
      ).toEqual({ kind: "refused", reason: MODEL_EDIT_REFUSALS.noteTitle });
    }
    expect(
      applyModelEdit(
        one,
        { kind: "note-text", index: 0, field: "title", value: "x".repeat(64) },
        false,
      ).kind,
    ).toBe("edited");
  });

  it("refuses a text over its cap", () => {
    expect(
      applyModelEdit(
        one,
        { kind: "note-text", index: 0, field: "text", value: "y".repeat(1025) },
        false,
      ),
    ).toEqual({ kind: "refused", reason: MODEL_EDIT_REFUSALS.noteText });
  });

  it("places a note again, keeping its words", () => {
    const there = { position: [1, 2, 3], normal: [0, 0, -1] } as const;
    const m = run(one, [{ kind: "note-place", index: 0, at: there }]);
    expect(m.annotations?.[0]).toEqual({
      position: [1, 2, 3],
      normal: [0, 0, -1],
      title: "Note 1",
    });
    expect(
      applyModelEdit(m, { kind: "note-place", index: 0, at: there }, false),
    ).toEqual({ kind: "unchanged" });
  });

  it("refuses a spot the format does not take", () => {
    for (const at of [
      { position: [0, 0, 0], normal: [0, 0, 0] },
      { position: [Number.NaN, 0, 0], normal: [0, 1, 0] },
      { position: [10_001, 0, 0], normal: [0, 1, 0] },
    ] as const) {
      expect(applyModelEdit(one, { kind: "note-add", at }, false)).toEqual({
        kind: "refused",
        reason: MODEL_EDIT_REFUSALS.spot,
      });
    }
  });

  it("refuses an index the model does not carry", () => {
    for (const index of [-1, 1, 0.5]) {
      expect(
        applyModelEdit(one, { kind: "note-delete", index }, false),
      ).toEqual({ kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchNote });
    }
  });

  it("refuses a note past the format's most", () => {
    const full = run(
      MODEL,
      Array.from({ length: TOUR_MODEL_MAX_NOTES }, () => ({
        kind: "note-add" as const,
        at: AT,
      })),
    );
    expect(full.annotations).toHaveLength(TOUR_MODEL_MAX_NOTES);
    expect(full.annotations?.[TOUR_MODEL_MAX_NOTES - 1]?.title).toBe(
      `Note ${String(TOUR_MODEL_MAX_NOTES)}`,
    );
    expect(applyModelEdit(full, { kind: "note-add", at: AT }, false)).toEqual({
      kind: "refused",
      reason: MODEL_EDIT_REFUSALS.notesFull,
    });
  });
});

describe("sections", () => {
  it("adds named sections up to the most, renames, places and deletes", () => {
    const four = run(
      MODEL,
      Array.from({ length: TOUR_MODEL_MAX_SECTIONS }, () => ({
        kind: "section-add" as const,
        at: AT,
      })),
    );
    expect(four.sections?.map((s) => s.name)).toEqual([
      "Section 1",
      "Section 2",
      "Section 3",
      "Section 4",
    ]);
    expect(
      applyModelEdit(four, { kind: "section-add", at: AT }, false),
    ).toEqual({ kind: "refused", reason: MODEL_EDIT_REFUSALS.sectionsFull });
    const m = run(four, [
      { kind: "section-name", index: 1, value: "Frame" },
      {
        kind: "section-place",
        index: 1,
        at: { position: [0, 1, 0], normal: [1, 0, 0] },
      },
      { kind: "section-delete", index: 0 },
    ]);
    expect(m.sections?.[0]).toEqual({
      name: "Frame",
      position: [0, 1, 0],
      normal: [1, 0, 0],
    });
    expect(m.sections).toHaveLength(3);
    // Adding sections never moves the view: the creator picks cutaway.
    expect(m.view).toBe("placed");
  });

  it("deleting the last section leaves the field out", () => {
    const m = run(MODEL, [
      { kind: "section-add", at: AT },
      { kind: "section-delete", index: 0 },
    ]);
    expect(m).not.toHaveProperty("sections");
  });

  it("refuses a blank name and one over the cap", () => {
    const m = run(MODEL, [{ kind: "section-add", at: AT }]);
    for (const value of ["", "z".repeat(41)]) {
      expect(
        applyModelEdit(m, { kind: "section-name", index: 0, value }, false),
      ).toEqual({ kind: "refused", reason: MODEL_EDIT_REFUSALS.sectionName });
    }
  });
});

describe("the view and the animation", () => {
  it("takes only a world view", () => {
    for (const view of ["stage", "card", "pin", "spin"]) {
      expect(applyModelEdit(MODEL, { kind: "view", view }, false)).toEqual({
        kind: "refused",
        reason: MODEL_EDIT_REFUSALS.view,
      });
    }
    expect(
      applyModelEdit(MODEL, { kind: "view", view: "placed" }, false),
    ).toEqual({ kind: "unchanged" });
    expect(run(MODEL, [{ kind: "view", view: "cutaway" }]).view).toBe(
      "cutaway",
    );
  });

  it("sets a clip and its autoplay, and a blank name removes it", () => {
    const m = run(MODEL, [
      { kind: "animation", name: "Swing", autoplay: true },
      { kind: "animation", name: "Swing", autoplay: false },
    ]);
    expect(m.animation).toEqual({ name: "Swing", autoplay: false });
    expect(
      run(m, [{ kind: "animation", name: "", autoplay: true }]),
    ).not.toHaveProperty("animation");
    expect(
      applyModelEdit(
        MODEL,
        { kind: "animation", name: "", autoplay: false },
        false,
      ),
    ).toEqual({ kind: "unchanged" });
    expect(
      applyModelEdit(
        MODEL,
        { kind: "animation", name: "c".repeat(129), autoplay: false },
        false,
      ),
    ).toEqual({ kind: "refused", reason: MODEL_EDIT_REFUSALS.animationName });
  });
});
