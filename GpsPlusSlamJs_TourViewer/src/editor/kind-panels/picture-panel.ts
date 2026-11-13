/**
 * A picture's panel in the item inspector (`kind-panel.ts`): its view as
 * chips (a plane, a framed print, a cut-out), what the view does in one
 * line, a cut-out's tag switch, and a warning when a cut-out's picture has
 * no see-through parts (it then stands as its rectangle). Its title,
 * caption, alt text, credit and year are the dock's fields
 * (`kinds/edit-kinds.ts`).
 *
 * Its buttons (`data-act`): `picture-view:<view>`, `picture-tag`.
 *
 * @see picture-panel.ts.md
 */
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import { chipGroup, el } from "../editor-shell/inspector-fields.js";
import type { KindPanel, KindPanelDraw, PanelItem } from "./kind-panel.js";

/** The views a creator picks among, in the format's order. */
const PICTURE_VIEW_CHOICES: readonly {
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
];

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
        key: `${picture.view}|${String(picture.showTag)}|${check}`,
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
      return false;
    },
    flush() {
      // It types nothing of its own.
    },
  };
}
