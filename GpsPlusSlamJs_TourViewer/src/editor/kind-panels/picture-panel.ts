/**
 * A picture's panel in the item inspector (`kind-panel.ts`): its view as
 * chips (a plane, a framed print, a cut-out, and the views seen from a
 * viewpoint), what the view does in one line, a cut-out's tag switch, a
 * warning when a cut-out's picture has no see-through parts (it then
 * stands as its rectangle), and in a viewpoint view its viewpoint: where
 * it stands, its facing, pitch, lens and depth, typed, and a fresh one in
 * front of the picture. Its title, caption, alt text, credit and year are
 * the dock's fields (`kinds/edit-kinds.ts`).
 *
 * Its buttons (`data-act`): `picture-view:<view>`, `picture-tag`,
 * `picture-viewpoint-new`, `picture-look-from` (the 3D view's camera
 * stood at the viewpoint). Its fields (`data-field`, committed by the
 * shell through `inspector-edits.ts`): `vp-north`, `vp-up`, `vp-east`,
 * `vp-facing`, `vp-pitch`, `vp-lens`, `vp-distance`.
 *
 * @see picture-panel.ts.md
 */
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import {
  chipGroup,
  el,
  fixed,
  numberField,
} from "../editor-shell/inspector-fields.js";
import { VIEWPOINT_FIELDS, type ViewpointFacts } from "../picture-viewpoint.js";
import type { KindPanel, KindPanelDraw, PanelItem } from "./kind-panel.js";

/** The views a creator picks among, in the format's order. */
export const PICTURE_VIEW_CHOICES: readonly {
  readonly view: string;
  readonly label: string;
  readonly note: string;
}[] = [
  { view: "plane", label: "Plane", note: "The picture alone, as a plane." },
  {
    view: "framed",
    label: "Framed",
    note: "In a frame, its year, caption and credit on a plate below; a tap shows all.",
  },
  {
    view: "cutout",
    label: "Cut-out",
    note: "Stands on the ground as its shape; a tap shows its words.",
  },
  {
    view: "thenNow",
    label: "Then and now",
    note: "From its spot the old picture lines up with today and fades in to half; the visitor can take over with a slider.",
  },
  {
    view: "sharpen",
    label: "Sharpen",
    note: "One whole picture that fades in as the visitor reaches its spot and faces its way.",
  },
  {
    view: "viewer",
    label: "Viewer",
    note: "A viewer stands at its spot; stepping up, the picture fades in as the viewer fades out.",
  },
  {
    view: "finder",
    label: "Finder",
    note: "Four corners in the air meet as a frame only from its spot; then the picture fills it.",
  },
  {
    view: "window",
    label: "Window",
    note: "A frame to look through: the picture hangs behind it, lined up from its spot.",
  },
];

/** The views drawn from a viewpoint: their panel types it. */
const VIEWPOINT_VIEWS: ReadonlySet<string> = new Set([
  "thenNow",
  "sharpen",
  "viewer",
  "finder",
  "window",
]);

/** Said over a viewpoint's fields. */
const VIEWPOINT_NOTE =
  "Where to stand to see it lined up, in the station's frame. Its spot shows in the 3D view.";

/** Where the visitor meets each of a picture's dock fields in each view
 *  the chips offer, in a few words; null: the view does not show it. The
 *  sheet is what a tap on the picture opens (a cut-out's shows its words
 *  only, so its alt text has no picture to describe). */
const FIELD_USE: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = {
  plane: { title: null, caption: null, alt: null, credit: null, year: null },
  framed: {
    title: "the sheet a tap opens",
    caption: "the plate (its first lines) and the sheet",
    alt: "the picture in the sheet, for a screen reader",
    credit: "the plate and the sheet",
    year: "the plate and the sheet",
  },
  cutout: {
    title: "the tag at its foot, and the sheet",
    caption: "the sheet, and the tag when there is no title",
    alt: null,
    credit: "the sheet",
    year: "the tag and the sheet",
  },
  thenNow: {
    title: "the sheet a tap opens",
    caption: "the slider once lined up (its first sentence), and the sheet",
    alt: "the picture in the sheet, for a screen reader",
    credit: "the sheet",
    year: "the slider and the sheet",
  },
  ...Object.fromEntries(
    ["sharpen", "viewer", "finder", "window"].map((view) => [
      view,
      {
        title: "the sheet a tap opens",
        caption: "the sheet",
        alt: "the picture in the sheet, for a screen reader",
        credit: "the sheet",
        year: "the sheet",
      },
    ]),
  ),
};

/** The label of the view `view`, or null for one the chips lack. */
function viewLabel(view: string): string | null {
  return PICTURE_VIEW_CHOICES.find((c) => c.view === view)?.label ?? null;
}

/**
 * The mark said under a picture's dock field `field` (its title, caption,
 * alt text, credit or year) in `view`: where the view shows it, or that
 * it does not. Null for a view the chips do not offer and a field that is
 * none of those.
 */
export function pictureFieldMark(view: string, field: string): string | null {
  const label = viewLabel(view);
  const uses = FIELD_USE[view];
  if (label === null || uses === undefined || !Object.hasOwn(uses, field)) {
    return null;
  }
  const use = uses[field];
  return use === null || use === undefined
    ? `Not used by ${label}.`
    : `Used by ${label}: ${use}.`;
}

/** Said under the chips for a view the chips do not offer. */
export const OTHER_VIEW_NOTE =
  "Shown in a view of its own here; a chip moves it to a standing view.";

/** Said for a cut-out whose picture has no see-through parts. */
export const NO_ALPHA_WARNING =
  "This picture has no see-through parts: the cut-out stands as its rectangle. Use a PNG or WebP with a clear background.";

export interface PicturePanelDeps {
  readonly setView: (itemId: string, view: string) => TypedEditOutcome;
  /** Absent: the page has no tag edit, and no switch is drawn. */
  readonly setTag?: (itemId: string, shown: boolean) => TypedEditOutcome;
  /** A picture's viewpoint set (null: a fresh one in front of it);
   *  absent: the page has no such edit, and no viewpoint is drawn. */
  readonly setViewpoint?: (
    itemId: string,
    viewpoint: TourPictureViewpoint | null,
  ) => TypedEditOutcome;
  /** Stand the 3D view's camera at the picture's viewpoint; absent: no
   *  button is drawn. */
  readonly lookFrom?: (itemId: string) => void;
  /** Whether the picture at a tour path has see-through parts; null:
   *  cannot tell. */
  readonly seeThrough: (path: string) => Promise<boolean | null>;
  /** A check finished: draw again. */
  readonly changed: () => void;
}

/** The panel; it remembers each image's check, asked once. */
export function createPicturePanel(deps: PicturePanelDeps): KindPanel {
  /** A path's check: pending, or its answer. */
  const checks = new Map<string, boolean | null | "pending">();
  const ask = (path: string): void => {
    if (checks.has(path)) return;
    checks.set(path, "pending");
    deps.seeThrough(path).then(
      (answer) => {
        checks.set(path, answer);
        deps.changed();
      },
      () => {
        checks.set(path, null);
      },
    );
  };

  /** A viewpoint view's section: its fields, or the button that gives
   *  it one. */
  const viewpointPart = (
    view: string,
    vp: ViewpointFacts | null,
  ): HTMLElement => {
    const box = el("div", "isec pviewpoint");
    box.append(
      el("div", "flabel", "Viewpoint"),
      el("div", "note", VIEWPOINT_NOTE),
      el(
        "div",
        "note use",
        `Used by ${viewLabel(view) ?? view}: it sets where the picture hangs, so its Position below is not used.`,
      ),
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
    if (vp !== null && deps.lookFrom !== undefined) {
      const look = el("button", "mini", "Look from the viewpoint");
      look.type = "button";
      look.dataset["act"] = "picture-look-from";
      box.append(look);
    }
    const fresh = el(
      "button",
      "mini",
      vp === null ? "Stand in front of it" : "Stand in front of it again",
    );
    fresh.type = "button";
    fresh.dataset["act"] = "picture-viewpoint-new";
    box.append(fresh);
    return box;
  };

  const parts = (picture: NonNullable<PanelItem["picture"]>): HTMLElement[] => {
    const box = el("div", "isec pview");
    const [label, chips] = chipGroup(
      "View",
      "picture-view",
      PICTURE_VIEW_CHOICES.map((c) => ({ value: c.view, label: c.label })),
      picture.view,
    );
    const choice = PICTURE_VIEW_CHOICES.find((c) => c.view === picture.view);
    box.append(
      label,
      chips,
      el("div", "note", choice?.note ?? OTHER_VIEW_NOTE),
    );
    if (picture.view === "cutout") {
      if (deps.setTag !== undefined) {
        const tag = el(
          "button",
          picture.showTag ? "mini on" : "mini",
          "Tag at its foot",
        );
        tag.type = "button";
        tag.dataset["act"] = "picture-tag";
        tag.setAttribute("aria-pressed", String(picture.showTag));
        box.append(tag);
      }
      const path = picture.imagePath;
      if (path !== null && checks.get(path) === false) {
        const warn = el("div", "note warn", NO_ALPHA_WARNING);
        warn.setAttribute("role", "status");
        box.append(warn);
      }
    }
    if (deps.setViewpoint !== undefined && VIEWPOINT_VIEWS.has(picture.view)) {
      return [box, viewpointPart(picture.view, picture.viewpoint)];
    }
    return [box];
  };

  return {
    sync(item): KindPanelDraw | null {
      const picture = item?.picture;
      if (item === null || picture === undefined) return null;
      if (picture.view === "cutout" && picture.imagePath !== null) {
        ask(picture.imagePath);
      }
      const check =
        picture.imagePath === null
          ? ""
          : String(checks.get(picture.imagePath) ?? "");
      return {
        key: `${picture.view}|${String(picture.showTag)}|${check}|${JSON.stringify(picture.viewpoint)}`,
        kept: null,
        ownsFields: false,
        title: () => null,
        head: () => [],
        parts: () => parts(picture),
      };
    },
    act(act, item, selected) {
      const picture = item.picture;
      if (picture === undefined) return false;
      const [name = "", arg] = act.split(":");
      if (name === "picture-view" && arg !== undefined) {
        if (arg === "cutout" && picture.imagePath !== null) {
          ask(picture.imagePath);
        }
        deps.setView(selected, arg);
        return true;
      }
      if (name === "picture-tag" && deps.setTag !== undefined) {
        deps.setTag(selected, !picture.showTag);
        return true;
      }
      if (name === "picture-viewpoint-new" && deps.setViewpoint !== undefined) {
        deps.setViewpoint(selected, null);
        return true;
      }
      if (name === "picture-look-from" && deps.lookFrom !== undefined) {
        deps.lookFrom(selected);
        return true;
      }
      return false;
    },
    flush() {
      // It types nothing of its own.
    },
  };
}
