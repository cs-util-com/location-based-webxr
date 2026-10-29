/**
 * Why this property matters: any sequence of the 3D inspector's model
 * edits must leave a model the tour's own reader takes back unchanged
 * (written as a draft record and read again) - no cap broken, no fifth
 * section, no thirty-third note, no empty list written, its id, asset,
 * size and place untouched. The unit tests check the cases someone
 * thought of; this one throws arbitrary edits, text and spots at it.
 */
import fc from "fast-check";
import {
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_SECTION_RULES,
  checkTourBlockText,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  parseTourObject,
  tourObjectRecord,
  type TourModel,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { applyModelEdit, type ModelEdit } from "./model-edits.js";

const GEO = { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 };
const MODEL = {
  id: "m",
  kind: "model",
  view: "placed",
  asset: "a",
  sizeM: 2,
  geo: GEO,
} as TourModel;

const num = fc.oneof(
  fc.double({ min: -10_000, max: 10_000, noNaN: true }),
  fc.constantFrom(0, 10_000.5, Number.NaN, Number.POSITIVE_INFINITY),
);
const vec = fc.tuple(num, num, num);
const spot = fc.record({ position: vec, normal: vec });
const text = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: "grapheme", maxLength: 1100 }),
  fc.constantFrom("", "  ", "x".repeat(65), "\u{1F600}".repeat(41)),
);
const index = fc.integer({ min: -1, max: 34 });
const edit: fc.Arbitrary<ModelEdit> = fc.oneof(
  fc.record({
    kind: fc.constant("view" as const),
    view: fc.constantFrom(
      "placed",
      "ghost",
      "hotspots",
      "cutaway",
      "toy",
      "stage",
    ),
  }),
  fc.record({ kind: fc.constant("note-add" as const), at: spot }),
  fc.record({
    kind: fc.constant("note-text" as const),
    index,
    field: fc.constantFrom("title" as const, "text" as const),
    value: text,
  }),
  fc.record({ kind: fc.constant("note-place" as const), index, at: spot }),
  fc.record({ kind: fc.constant("note-delete" as const), index }),
  fc.record({ kind: fc.constant("section-add" as const), at: spot }),
  fc.record({
    kind: fc.constant("section-name" as const),
    index,
    value: text,
  }),
  fc.record({ kind: fc.constant("section-place" as const), index, at: spot }),
  fc.record({ kind: fc.constant("section-delete" as const), index }),
  fc.record({
    kind: fc.constant("animation" as const),
    name: text,
    autoplay: fc.boolean(),
  }),
);

const play = (model: TourModel, edits: ModelEdit[], explicit: boolean) => {
  let m = model;
  for (const e of edits) {
    const outcome = applyModelEdit(m, e, explicit);
    if (outcome.kind === "edited") m = outcome.after;
  }
  return m;
};

describe("model edits (property)", () => {
  it("keep every model one the reader takes back as written", () => {
    fc.assert(
      fc.property(
        fc.array(edit, { maxLength: 60 }),
        fc.boolean(),
        (edits, explicit) => {
          const model = play(MODEL, edits, explicit);
          expect(parseTourObject(tourObjectRecord(model))).toEqual(model);
          const notes = model.annotations ?? [];
          const sections = model.sections ?? [];
          // An empty list is never written: the field is left out.
          expect(model.annotations?.length).not.toBe(0);
          expect(model.sections?.length).not.toBe(0);
          expect(notes.length).toBeLessThanOrEqual(TOUR_MODEL_MAX_NOTES);
          expect(sections.length).toBeLessThanOrEqual(TOUR_MODEL_MAX_SECTIONS);
          for (const n of notes) {
            expect(
              checkTourBlockText(TOUR_MODEL_NOTE_RULES.title, n.title).ok,
            ).toBe(true);
            expect(
              n.text === undefined ||
                checkTourBlockText(TOUR_MODEL_NOTE_RULES.text, n.text).ok,
            ).toBe(true);
          }
          for (const s of sections) {
            expect(
              checkTourBlockText(TOUR_MODEL_SECTION_RULES.name, s.name).ok,
            ).toBe(true);
          }
          const { id, asset, sizeM, geo } = model;
          expect({ id, asset, sizeM, geo }).toEqual({
            id: MODEL.id,
            asset: MODEL.asset,
            sizeM: MODEL.sizeM,
            geo: MODEL.geo,
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never overrides a view the creator chose", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("placed", "ghost", "hotspots", "cutaway", "toy"),
        fc.array(
          edit.filter((e) => e.kind !== "view"),
          { maxLength: 40 },
        ),
        (view, edits) => {
          const model = play({ ...MODEL, view }, edits, true);
          expect(model.view).toBe(view);
        },
      ),
    );
  });
});
