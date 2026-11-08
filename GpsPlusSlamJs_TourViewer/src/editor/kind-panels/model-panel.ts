/**
 * A 3D model's panel in the item inspector (`kind-panel.ts`): its size,
 * its view, its clip, its notes and its sections, drawn from the
 * inspector's model (`InspectorModelParts`), and the presses of their
 * buttons answered as model edits (`model-edits.ts`) or as what the 3D
 * view waits for (a click on the model, a part in focus).
 *
 * Its buttons (`data-act`): `view:<view>`, `anim-autoplay`, `note:<i>`
 * and `section:<i>` (a part into focus, pressed again: out of it),
 * `note-add`, `section-add`, `note-place:<i>`, `section-place:<i>` (the 3D
 * view asked to wait for a click on the model, pressed again: not),
 * `note-delete:<i>`, `section-delete:<i>`, `section-flip:<i>`. Its fields
 * (`data-field`, committed by the shell through `inspector-edits.ts`):
 * `size`, `anim-name`, `note-title:<i>`, `note-text:<i>`,
 * `section-name:<i>`.
 *
 * @see model-panel.ts.md
 */
import {
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_SECTION_RULES,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import {
  chipGroup,
  el,
  fieldId,
  fixed,
  lineField,
  numberField,
  typed,
} from "../editor-shell/inspector-fields.js";
import {
  MODEL_VIEW_CHOICES,
  type InspectorModelParts,
} from "../editor-shell/inspector-model.js";
import type { ModelFocus, ModelPick } from "../editor-view.js";
import type { ModelEdit } from "../model-edits.js";
import { wireTextCounter } from "../../pin-text.js";
import type { KindPanel, KindPanelDraw } from "./kind-panel.js";

export interface ModelPanelDeps {
  /** One of a model's own edits: one undo step, a refusal said by the
   *  page. */
  readonly editModel: (itemId: string, edit: ModelEdit) => TypedEditOutcome;
  /** The click the 3D view waits for on the model (null: none). */
  readonly pickAsked: (pick: ModelPick | null) => void;
  /** The note or section in focus (null: none). */
  readonly focused: (focus: ModelFocus | null) => void;
}

/** A line of a model's part to type (a note's title, a section's name),
 *  its count against the format's cap beside it. */
function partLine(
  field: string,
  aria: string,
  value: string,
  max: number,
): HTMLElement[] {
  const input = typed(field, value, "tfield");
  input.setAttribute("aria-label", aria);
  input.id = fieldId();
  const count = el("output", "note count");
  count.id = `${input.id}-count`;
  input.setAttribute("aria-describedby", count.id);
  wireTextCounter(input, count, max, "codePoints");
  return [input, count];
}

/** A small button of a model's part (`data-act`), pressed while `on`. */
function partButton(act: string, label: string, on = false): HTMLButtonElement {
  const b = el("button", on ? "mini on" : "mini", label);
  b.type = "button";
  b.dataset["act"] = act;
  if (on) b.setAttribute("aria-pressed", "true");
  return b;
}

/** A model-space point as the inspector shows it. */
function spotText(v: readonly number[]): string {
  return v.map((x) => fixed(x, 2)).join(", ");
}

/** What a model's view does, under its choice. */
const VIEW_NOTE: Readonly<Record<string, string>> = {
  placed: "Stands at its place and size.",
  ghost: "Glass, its feet fading into the ground.",
  hotspots: "Its notes drawn on it; its animation held at rest.",
  cutaway: "Cut open by its sections, one after the other.",
  toy: "The visitor may move and resize it.",
};

/** Its largest side to type, with what it means. */
function sizeParts(sizeM: number): HTMLElement {
  const section = el("div", "isec");
  section.append(
    numberField("Size", "size", fixed(sizeM, 2), "m"),
    el(
      "div",
      "note",
      "Its largest side, from 0.05 m to 500 m. Drag a white dot to resize.",
    ),
  );
  return section;
}

/** A model's view, clip, notes and sections. */
function modelParts(parts: InspectorModelParts): HTMLElement[] {
  const view = el("div", "isec mview");
  const [label, chips] = chipGroup(
    "View",
    "view",
    MODEL_VIEW_CHOICES.map((c) => ({ value: c.view, label: c.label })),
    parts.view,
  );
  // Notes are drawn only in the Hotspots view: say so where they would
  // otherwise seem lost.
  const notesHidden = parts.view !== "hotspots" && parts.notes.length > 0;
  const viewNote =
    (VIEW_NOTE[parts.view] ?? "") +
    (notesHidden ? " Its notes show only in Hotspots." : "");
  view.append(label, chips, el("div", "note", viewNote.trim()));

  const clip = el("div", "isec manim");
  const autoplay = partButton(
    "anim-autoplay",
    "Plays by itself",
    parts.animation?.autoplay === true,
  );
  autoplay.disabled = parts.animation === null;
  autoplay.setAttribute(
    "aria-pressed",
    String(parts.animation?.autoplay === true),
  );
  clip.append(
    lineField(
      "Animation",
      "anim-name",
      parts.animation?.name ?? "",
      "The clip's name in the model file",
    ),
    autoplay,
  );

  const notes = el("div", "isec mnotes");
  notes.append(el("div", "flabel", `Notes (${String(parts.notes.length)})`));
  const pick = parts.pick;
  parts.notes.forEach((n, i) => {
    const on = parts.focus?.part === "note" && parts.focus.index === i;
    const row = el("div", on ? "anno on" : "anno");
    row.dataset["note"] = String(i);
    const top = el("div", "top");
    const badge = el("button", "badge", String(i + 1));
    badge.type = "button";
    badge.dataset["act"] = `note:${String(i)}`;
    badge.setAttribute("aria-label", `Note ${String(i + 1)}`);
    badge.setAttribute("aria-pressed", String(on));
    top.append(
      badge,
      ...partLine(
        `note-title:${String(i)}`,
        `Note ${String(i + 1)} title`,
        n.title,
        TOUR_MODEL_NOTE_RULES.title.max,
      ),
    );
    const text = el("textarea", "tfield");
    text.rows = 2;
    text.spellcheck = false;
    text.dataset["field"] = `note-text:${String(i)}`;
    text.placeholder = "What the visitor reads";
    text.defaultValue = n.text.replace(/\r\n?/g, "\n");
    text.id = fieldId();
    text.setAttribute("aria-label", `Note ${String(i + 1)} text`);
    const count = el("output", "note count");
    count.id = `${text.id}-count`;
    text.setAttribute("aria-describedby", count.id);
    wireTextCounter(
      text,
      count,
      TOUR_MODEL_NOTE_RULES.text.max,
      TOUR_MODEL_NOTE_RULES.text.unit,
    );
    const picking = pick?.what === "note-place" && pick.index === i;
    const tools = el("div", "tools");
    tools.append(
      partButton(
        `note-place:${String(i)}`,
        picking ? "Click the model..." : "Pick on model",
        picking,
      ),
      partButton(`note-delete:${String(i)}`, "Delete"),
      el("span", "pos", spotText(n.position)),
    );
    row.append(top, text, count, tools);
    notes.append(row);
  });
  const adding = pick?.what === "note-add";
  const add = partButton(
    "note-add",
    adding ? "Click the model..." : "+ Add note (click the model)",
    adding,
  );
  add.disabled = parts.notesFull;
  notes.append(add);
  if (parts.notes.length > 0 && parts.view !== "hotspots") {
    notes.append(
      el("div", "note", "The visitor sees notes in the Hotspots view."),
    );
  }

  const sections = el("div", "isec msections");
  sections.append(
    el("div", "flabel", `Sections (${String(parts.sections.length)})`),
  );
  parts.sections.forEach((c, i) => {
    const on = parts.focus?.part === "section" && parts.focus.index === i;
    const row = el("div", on ? "anno on" : "anno");
    row.dataset["section"] = String(i);
    const top = el("div", "top");
    const badge = el("button", "badge", String(i + 1));
    badge.type = "button";
    badge.dataset["act"] = `section:${String(i)}`;
    badge.setAttribute("aria-label", `Section ${String(i + 1)}`);
    badge.setAttribute("aria-pressed", String(on));
    top.append(
      badge,
      ...partLine(
        `section-name:${String(i)}`,
        `Section ${String(i + 1)} name`,
        c.name,
        TOUR_MODEL_SECTION_RULES.name.max,
      ),
    );
    const picking = pick?.what === "section-place" && pick.index === i;
    const tools = el("div", "tools");
    tools.append(
      partButton(
        `section-place:${String(i)}`,
        picking ? "Click the model..." : "Place on model",
        picking,
      ),
      partButton(`section-flip:${String(i)}`, "Flip"),
      partButton(`section-delete:${String(i)}`, "Delete"),
      el("span", "pos", spotText(c.position)),
    );
    row.append(top, tools);
    sections.append(row);
  });
  const cutting = pick?.what === "section-add";
  const addCut = partButton(
    "section-add",
    cutting ? "Click the model..." : "+ Add section (click the model)",
    cutting,
  );
  addCut.disabled = parts.sectionsFull;
  sections.append(
    addCut,
    el(
      "div",
      "note",
      "A section cuts the model through the point you click; the side facing you is cut away. Shown in the Cutaway view.",
    ),
  );
  return [view, clip, notes, sections];
}

/** A model's panel: drawn from the item's model parts, its buttons
 *  answered through `deps`. */
export function createModelPanel(deps: ModelPanelDeps): KindPanel {
  return {
    sync(item): KindPanelDraw | null {
      const model = item?.model ?? null;
      if (item === null || model === null) return null;
      return {
        key: "",
        kept: null,
        ownsFields: false,
        title: () => null,
        head: () => [],
        parts: () => [
          ...(item.sizeM === null ? [] : [sizeParts(item.sizeM)]),
          ...modelParts(model),
        ],
      };
    },
    act(act, item, selected) {
      const parts = item.model;
      if (parts === null) return false;
      const [name = "", arg] = act.split(":");
      const index = arg === undefined ? -1 : Number(arg);
      const pickNow = parts.pick;
      const ask = (pick: ModelPick) => {
        const same =
          pickNow?.what === pick.what &&
          ("index" in pickNow ? pickNow.index : -1) ===
            ("index" in pick ? pick.index : -1);
        deps.pickAsked(same ? null : pick);
      };
      const focus = (part: "note" | "section") => {
        const on = parts.focus?.part === part && parts.focus.index === index;
        deps.focused(on ? null : { part, index });
      };
      switch (name) {
        case "view":
          if (arg !== undefined)
            deps.editModel(selected, { kind: "view", view: arg });
          return true;
        case "note":
          focus("note");
          return true;
        case "section":
          focus("section");
          return true;
        case "note-add":
        case "section-add":
          ask({ what: name });
          return true;
        case "note-place":
        case "section-place":
          ask({ what: name, index });
          if (
            pickNow === null ||
            !("index" in pickNow) ||
            pickNow.index !== index
          ) {
            deps.focused({
              part: name === "note-place" ? "note" : "section",
              index,
            });
          }
          return true;
        case "note-delete":
        case "section-delete":
          if (deps.editModel(selected, { kind: name, index }) === "written") {
            deps.focused(null);
            deps.pickAsked(null);
          }
          return true;
        case "section-flip": {
          const section = parts.sections[index];
          if (section === undefined) return true;
          const [x, y, z] = section.normal;
          deps.editModel(selected, {
            kind: "section-place",
            index,
            // 0 - x, not -x: a zero stays 0, never -0.
            at: { position: section.position, normal: [0 - x, 0 - y, 0 - z] },
          });
          return true;
        }
        case "anim-autoplay":
          if (parts.animation !== null) {
            deps.editModel(selected, {
              kind: "animation",
              name: parts.animation.name,
              autoplay: !parts.animation.autoplay,
            });
          }
          return true;
        default:
          return false;
      }
    },
    flush() {
      // Its fields are the dock's, committed by the shell.
    },
  };
}
