/**
 * A 3D model's own edits as the desktop editor's 3D inspector makes them
 * (pure): its view, its notes (add by a point on its surface, edit a
 * note's title and text, place it again, delete it), its cutaway's
 * sections (add, name, place, delete) and its animation clip. Every cap is
 * the format's (`TOUR_MODEL_NOTE_RULES`, `TOUR_MODEL_SECTION_RULES`,
 * `TOUR_MODEL_ANIMATION_RULES`, `TOUR_MODEL_MAX_NOTES`,
 * `TOUR_MODEL_MAX_SECTIONS`, `TOUR_MODEL_SPACE_MAX`), checked with the
 * format's own counter, so what the editor takes the file's reader reads.
 *
 * The default rule: a model's notes are drawn in its `hotspots` view, so
 * the first note added to a model in `placed` switches it to `hotspots`,
 * and deleting the last note of a model in `hotspots` switches it back to
 * `placed` - unless the creator chose its view himself (`explicitView`),
 * which no note ever overrides.
 *
 * @see model-edits.ts.md
 */
import {
  TOUR_MODEL_ANIMATION_RULES,
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_MIN_DIRECTION_LENGTH,
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_SECTION_RULES,
  TOUR_MODEL_SPACE_MAX,
  TOUR_MODEL_WORLD_VIEWS,
  checkTourBlockText,
  type TourModelNote,
  type TourModelSection,
  type TourModelVector,
  type TourModelWorldView,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourModel } from "gps-plus-slam-app-framework/ar/tour-manifest";

/** A point on the model and the direction it faces, in the model's own
 *  space (its file's frame and units). */
export interface ModelSpot {
  readonly position: TourModelVector;
  readonly normal: TourModelVector;
}

/** One edit of a model; `index` counts its notes or sections from 0. */
export type ModelEdit =
  | { readonly kind: "view"; readonly view: string }
  | { readonly kind: "note-add"; readonly at: ModelSpot }
  | {
      readonly kind: "note-text";
      readonly index: number;
      readonly field: "title" | "text";
      readonly value: string;
    }
  | {
      readonly kind: "note-place";
      readonly index: number;
      readonly at: ModelSpot;
    }
  | { readonly kind: "note-delete"; readonly index: number }
  | { readonly kind: "section-add"; readonly at: ModelSpot }
  | {
      readonly kind: "section-name";
      readonly index: number;
      readonly value: string;
    }
  | {
      readonly kind: "section-place";
      readonly index: number;
      readonly at: ModelSpot;
    }
  | { readonly kind: "section-delete"; readonly index: number }
  | {
      readonly kind: "animation";
      /** The clip's name; blank: no clip. */
      readonly name: string;
      readonly autoplay: boolean;
    };

/** The model after the edit and what the undo button calls it ("the
 *  title of note 2": the session adds the model's name), nothing to
 *  change, or refused with the words the creator reads. */
export type ModelEditOutcome =
  | {
      readonly kind: "edited";
      readonly after: TourModel;
      readonly what: string;
    }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string };

/** What the creator reads for each refusal. */
export const MODEL_EDIT_REFUSALS = {
  view: "A model in the world is placed, ghost, hotspots, cutaway or toy.",
  notesFull: `A model carries at most ${String(TOUR_MODEL_MAX_NOTES)} notes.`,
  sectionsFull: `A cutaway has at most ${String(TOUR_MODEL_MAX_SECTIONS)} sections.`,
  noSuchNote: "That note is no longer on the model.",
  noSuchSection: "That section is no longer on the model.",
  spot: `A point on the model must be three numbers within ${String(TOUR_MODEL_SPACE_MAX)} of its origin, its direction not zero.`,
  noteTitle: `A note needs a title of at most ${String(TOUR_MODEL_NOTE_RULES.title.max)} characters.`,
  noteText: `A note's text takes at most ${String(TOUR_MODEL_NOTE_RULES.text.max)} characters.`,
  sectionName: `A section needs a name of at most ${String(TOUR_MODEL_SECTION_RULES.name.max)} characters.`,
  animationName: `A clip's name takes at most ${String(TOUR_MODEL_ANIMATION_RULES.name.max)} characters.`,
} as const;

const WORLD_VIEWS: ReadonlySet<string> = new Set(TOUR_MODEL_WORLD_VIEWS);

/** Whether `view` is a view a model stands in the world in. */
function isModelWorldView(view: string): view is TourModelWorldView {
  return WORLD_VIEWS.has(view);
}

const isVector = (v: unknown, direction: boolean): v is TourModelVector =>
  Array.isArray(v) &&
  v.length === 3 &&
  (v as unknown[]).every(
    (x) =>
      typeof x === "number" &&
      Number.isFinite(x) &&
      Math.abs(x) <= TOUR_MODEL_SPACE_MAX,
  ) &&
  (!direction ||
    Math.hypot(...(v as [number, number, number])) >=
      TOUR_MODEL_MIN_DIRECTION_LENGTH);

/** Whether `at` is a spot the format takes. */
function isModelSpot(at: ModelSpot): boolean {
  return isVector(at.position, false) && isVector(at.normal, true);
}

const sameVector = (a: TourModelVector, b: TourModelVector): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const copyOf = (v: TourModelVector): TourModelVector => [v[0], v[1], v[2]];

/** The model with its notes `notes` (none: the field left out, as the
 *  format reads an empty list). */
function withNotes(
  model: TourModel,
  notes: readonly TourModelNote[],
): TourModel {
  const { annotations: _old, ...rest } = model;
  return notes.length === 0 ? rest : { ...rest, annotations: notes };
}

function withSections(
  model: TourModel,
  sections: readonly TourModelSection[],
): TourModel {
  const { sections: _old, ...rest } = model;
  return sections.length === 0 ? rest : { ...rest, sections };
}

const inRange = (index: number, length: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < length;

/**
 * `edit` applied to `model`. `explicitView` says the creator chose the
 * model's view himself this session: the default rule then leaves it.
 */
export function applyModelEdit(
  model: TourModel,
  edit: ModelEdit,
  explicitView: boolean,
): ModelEditOutcome {
  const notes = model.annotations ?? [];
  const sections = model.sections ?? [];
  const edited = (after: TourModel, what: string): ModelEditOutcome => ({
    kind: "edited",
    after,
    what,
  });
  switch (edit.kind) {
    case "view": {
      if (!isModelWorldView(edit.view)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.view };
      }
      if (edit.view === model.view) return { kind: "unchanged" };
      return edited({ ...model, view: edit.view }, "the view");
    }
    case "note-add": {
      if (notes.length >= TOUR_MODEL_MAX_NOTES) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.notesFull };
      }
      if (!isModelSpot(edit.at)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.spot };
      }
      const note: TourModelNote = {
        position: copyOf(edit.at.position),
        normal: copyOf(edit.at.normal),
        title: `Note ${String(notes.length + 1)}`,
      };
      const after = withNotes(model, [...notes, note]);
      const switched =
        !explicitView && notes.length === 0 && model.view === "placed";
      return edited(
        switched ? { ...after, view: "hotspots" } : after,
        "the new note",
      );
    }
    case "note-text": {
      const note = notes[edit.index];
      if (note === undefined || !inRange(edit.index, notes.length)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchNote };
      }
      let next: TourModelNote;
      if (edit.field === "title") {
        const checked = checkTourBlockText(
          TOUR_MODEL_NOTE_RULES.title,
          edit.value,
        );
        if (!checked.ok) {
          return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noteTitle };
        }
        if (checked.value === note.title) return { kind: "unchanged" };
        next = { ...note, title: checked.value };
      } else {
        if (edit.value.trim() === "") {
          if (note.text === undefined) return { kind: "unchanged" };
          const { text: _gone, ...rest } = note;
          next = rest;
        } else {
          const checked = checkTourBlockText(
            TOUR_MODEL_NOTE_RULES.text,
            edit.value,
          );
          if (!checked.ok) {
            return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noteText };
          }
          if (checked.value === note.text) return { kind: "unchanged" };
          next = { ...note, text: checked.value };
        }
      }
      return edited(
        withNotes(
          model,
          notes.map((n, i) => (i === edit.index ? next : n)),
        ),
        `the ${edit.field} of note ${String(edit.index + 1)}`,
      );
    }
    case "note-place": {
      const note = notes[edit.index];
      if (note === undefined || !inRange(edit.index, notes.length)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchNote };
      }
      if (!isModelSpot(edit.at)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.spot };
      }
      if (
        sameVector(note.position, edit.at.position) &&
        sameVector(note.normal, edit.at.normal)
      ) {
        return { kind: "unchanged" };
      }
      const next: TourModelNote = {
        ...note,
        position: copyOf(edit.at.position),
        normal: copyOf(edit.at.normal),
      };
      return edited(
        withNotes(
          model,
          notes.map((n, i) => (i === edit.index ? next : n)),
        ),
        `the place of note ${String(edit.index + 1)}`,
      );
    }
    case "note-delete": {
      if (!inRange(edit.index, notes.length)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchNote };
      }
      const after = withNotes(
        model,
        notes.filter((_n, i) => i !== edit.index),
      );
      const switched =
        !explicitView && notes.length === 1 && model.view === "hotspots";
      return edited(
        switched ? { ...after, view: "placed" } : after,
        `the delete of note ${String(edit.index + 1)}`,
      );
    }
    case "section-add": {
      if (sections.length >= TOUR_MODEL_MAX_SECTIONS) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.sectionsFull };
      }
      if (!isModelSpot(edit.at)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.spot };
      }
      const section: TourModelSection = {
        name: `Section ${String(sections.length + 1)}`,
        position: copyOf(edit.at.position),
        normal: copyOf(edit.at.normal),
      };
      return edited(
        withSections(model, [...sections, section]),
        "the new section",
      );
    }
    case "section-name": {
      const section = sections[edit.index];
      if (section === undefined || !inRange(edit.index, sections.length)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchSection };
      }
      const checked = checkTourBlockText(
        TOUR_MODEL_SECTION_RULES.name,
        edit.value,
      );
      if (!checked.ok) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.sectionName };
      }
      if (checked.value === section.name) return { kind: "unchanged" };
      return edited(
        withSections(
          model,
          sections.map((s, i) =>
            i === edit.index ? { ...s, name: checked.value } : s,
          ),
        ),
        `the name of section ${String(edit.index + 1)}`,
      );
    }
    case "section-place": {
      const section = sections[edit.index];
      if (section === undefined || !inRange(edit.index, sections.length)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchSection };
      }
      if (!isModelSpot(edit.at)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.spot };
      }
      if (
        sameVector(section.position, edit.at.position) &&
        sameVector(section.normal, edit.at.normal)
      ) {
        return { kind: "unchanged" };
      }
      return edited(
        withSections(
          model,
          sections.map((s, i) =>
            i === edit.index
              ? {
                  ...s,
                  position: copyOf(edit.at.position),
                  normal: copyOf(edit.at.normal),
                }
              : s,
          ),
        ),
        `the place of section ${String(edit.index + 1)}`,
      );
    }
    case "section-delete": {
      if (!inRange(edit.index, sections.length)) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.noSuchSection };
      }
      return edited(
        withSections(
          model,
          sections.filter((_s, i) => i !== edit.index),
        ),
        `the delete of section ${String(edit.index + 1)}`,
      );
    }
    case "animation": {
      if (edit.name.trim() === "") {
        if (model.animation === undefined) return { kind: "unchanged" };
        const { animation: _gone, ...rest } = model;
        return edited(rest, "the animation");
      }
      const checked = checkTourBlockText(
        TOUR_MODEL_ANIMATION_RULES.name,
        edit.name,
      );
      if (!checked.ok) {
        return { kind: "refused", reason: MODEL_EDIT_REFUSALS.animationName };
      }
      const now = model.animation;
      if (now?.name === checked.value && now.autoplay === edit.autoplay) {
        return { kind: "unchanged" };
      }
      return edited(
        {
          ...model,
          animation: { name: checked.value, autoplay: edit.autoplay },
        },
        "the animation",
      );
    }
  }
}
