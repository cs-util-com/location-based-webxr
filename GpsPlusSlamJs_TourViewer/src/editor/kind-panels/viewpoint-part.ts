/**
 * A viewpoint's section in a kind's inspector panel, shared by the picture
 * and the video panels: a note on what a viewpoint is, a line on what the
 * view uses it for, its fields typed (where it stands, its facing, pitch,
 * lens and depth; `picture-viewpoint.ts` `VIEWPOINT_FIELDS`), and the
 * buttons that stand the 3D view's camera at it and that stand a fresh one
 * in front of the block. The fields are committed by the shell through
 * `inspector-edits.ts`; the buttons carry the acts the panel passes.
 *
 * @see viewpoint-part.ts.md
 */
import { el, fixed, numberField } from "../editor-shell/inspector-fields.js";
import { VIEWPOINT_FIELDS, type ViewpointFacts } from "../picture-viewpoint.js";

/** Said over a viewpoint's fields. */
const VIEWPOINT_NOTE =
  "Where to stand to see it lined up, in the station's frame. Its spot shows in the 3D view.";

export interface ViewpointPartOptions {
  /** The viewpoint; null: none yet, only the button that gives one. */
  readonly vp: ViewpointFacts | null;
  /** What the view uses it for, said under the note. */
  readonly use: string;
  /** The act of "Look from the viewpoint"; null: no such button. */
  readonly lookFromAct: string | null;
  /** The act of the button that stands a fresh one in front of it. */
  readonly freshAct: string;
}

/** The section: its fields, or the button that gives it one. */
export function viewpointPart(options: ViewpointPartOptions): HTMLElement {
  const { vp } = options;
  const box = el("div", "isec pviewpoint");
  box.append(
    el("div", "flabel", "Viewpoint"),
    el("div", "note", VIEWPOINT_NOTE),
    el("div", "note use", options.use),
  );
  if (vp !== null) {
    const values: Readonly<Record<string, number>> = {
      "vp-north": vp.northM,
      "vp-up": vp.upM,
      "vp-east": vp.eastM,
      "vp-facing": vp.facingDeg,
      "vp-pitch": vp.pitchDeg,
      "vp-lens": vp.lensDeg,
      "vp-distance": vp.distanceM,
    };
    for (const f of VIEWPOINT_FIELDS) {
      const value = values[f.field] ?? 0;
      box.append(
        numberField(
          f.label,
          f.field,
          fixed(value, f.unit === "m" ? 2 : 1),
          f.unit,
        ),
      );
    }
  }
  if (vp !== null && options.lookFromAct !== null) {
    const look = el("button", "mini", "Look from the viewpoint");
    look.type = "button";
    look.dataset["act"] = options.lookFromAct;
    box.append(look);
  }
  const fresh = el(
    "button",
    "mini",
    vp === null ? "Stand in front of it" : "Stand in front of it again",
  );
  fresh.type = "button";
  fresh.dataset["act"] = options.freshAct;
  box.append(fresh);
  return box;
}
