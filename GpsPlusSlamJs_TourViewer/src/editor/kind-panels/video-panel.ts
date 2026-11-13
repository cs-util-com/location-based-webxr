/**
 * A free video's panel in the item inspector (`kind-panel.ts`): its view
 * (screen, cutout, porthole) and its choices in that view - how it
 * starts, whether it starts with its sound, a cutout's background - as
 * chips, the one in use pressed, with a line under the view saying what
 * it does. A press writes the view (`edits.view`) or the choice
 * (`edits.block`, refused or written by `block-fields.ts`); the `near`
 * start's distance is a number the dock types (`KIND_EDIT` `fields`).
 *
 * Its buttons (`data-act`): `video-view:<view>` and
 * `video-set:<field>:<value>`.
 *
 * @see video-panel.ts.md
 */
import { TOUR_FREE_BLOCK_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import { chipGroup, el } from "../editor-shell/inspector-fields.js";
import type { InspectorVideo } from "../editor-shell/inspector-model.js";
import type { KindPanel, KindPanelDraw } from "./kind-panel.js";

export interface VideoPanelDeps {
  /** Writes a free block's view: one undo step, a refusal said by the
   *  page. */
  readonly writeView: (itemId: string, view: string) => TypedEditOutcome;
  /** Writes one of its choices (`blockFieldEdit`). */
  readonly writeChoice: (
    itemId: string,
    field: string,
    value: string,
  ) => TypedEditOutcome;
}

/** A free video's views in the inspector's words, in the format's order. */
export const VIDEO_VIEW_CHOICES: readonly {
  readonly value: string;
  readonly label: string;
}[] = TOUR_FREE_BLOCK_VIEWS.video.map((view) => ({
  value: view,
  label: view.charAt(0).toUpperCase() + view.slice(1),
}));

/** What a video's view does, under its choice. */
const VIEW_NOTE: Readonly<Record<string, string>> = {
  screen: "A screen on a stand, with its controls under it.",
  cutout:
    "The person or thing in it stands in the place, turning to the visitor.",
  porthole: "A round window with its poster; a tap opens the clip large.",
};

/** A cutout without its matte shows its filmed background, softened at
 *  the edge: said where the creator chooses it. */
const CUTOUT_AS_FILMED =
  "A clean edge needs a stacked-alpha video: its matte under the picture.";

/** The panel's acts. */
const VIEW_ACT = /^video-view:(.+)$/;
const SET_ACT = /^video-set:([^:]+):(.+)$/;

function videoParts(video: InspectorVideo): HTMLElement {
  const box = el("div", "isec video");
  const [label, chips] = chipGroup(
    "View",
    "video-view",
    VIDEO_VIEW_CHOICES,
    video.view,
  );
  box.append(label, chips, el("div", "note", VIEW_NOTE[video.view] ?? ""));
  for (const choice of video.choices) {
    box.append(
      ...chipGroup(
        choice.label,
        `video-set:${choice.name}`,
        choice.values,
        choice.value,
      ),
    );
    if (choice.name === "alpha" && choice.value === "none") {
      box.append(el("div", "note", CUTOUT_AS_FILMED));
    }
  }
  return box;
}

/** A free video's panel. */
export function createVideoPanel(deps: VideoPanelDeps): KindPanel {
  return {
    sync(item): KindPanelDraw | null {
      const video = item?.video ?? null;
      if (video === null) return null;
      return {
        key: "",
        kept: null,
        ownsFields: false,
        title: () => null,
        head: () => [],
        parts: () => [videoParts(video)],
      };
    },
    act(name, item, selected) {
      const video = item.video;
      if (video === null) return false;
      const view = VIEW_ACT.exec(name);
      if (view !== null) {
        const [, value] = view as unknown as [string, string];
        if (value !== video.view) deps.writeView(selected, value);
        return true;
      }
      const set = SET_ACT.exec(name);
      if (set === null) return false;
      const [, field, value] = set as unknown as [string, string, string];
      const choice = video.choices.find((c) => c.name === field);
      // A choice of another view (or none) is not this panel's to write.
      if (choice === undefined) return false;
      if (value !== choice.value) deps.writeChoice(selected, field, value);
      return true;
    },
    flush() {
      // Nothing typed: every chip writes at once.
    },
  };
}
