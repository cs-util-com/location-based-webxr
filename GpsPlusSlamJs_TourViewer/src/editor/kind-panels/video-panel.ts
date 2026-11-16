/**
 * A free video's panel in the item inspector (`kind-panel.ts`): its view
 * (screen, cutout, porthole, window, stand here) and its choices in that view - how it
 * starts, whether it starts with its sound, a cutout's background - as
 * chips, the one in use pressed, with a line under the view saying what
 * it does; its loop as one switch; and a line saying how many caption
 * cues its WebVTT read to (the text itself is a dock field). A press writes the view (`edits.view`) or the choice
 * (`edits.block`, refused or written by `block-fields.ts`); the `near`
 * start's distance is a number the dock types (`KIND_EDIT` `fields`).
 *
 * In the stand-here view its viewpoint, where the visitor stands, typed
 * with a picture's fields (`viewpoint-part.ts`), with a fresh one in front
 * of the video and the 3D view's camera stood at it.
 *
 * Its buttons (`data-act`): `video-view:<view>`,
 * `video-set:<field>:<value>`, `video-viewpoint-new` and
 * `video-look-from`. Its viewpoint fields (`vp-*`) are committed by the
 * shell through `inspector-edits.ts`.
 *
 * @see video-panel.ts.md
 */
import {
  TOUR_FREE_BLOCK_VIEWS,
  tourSeenFromViewpoint,
  type TourPictureViewpoint,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import { captionsStatus } from "../../kinds/video/video-captions.js";
import { chipGroup, el } from "../editor-shell/inspector-fields.js";
import type { InspectorVideo } from "../editor-shell/inspector-model.js";
import type { KindPanel, KindPanelDraw } from "./kind-panel.js";
import { videoPreview, type VideoPreview } from "./video-preview.js";
import { viewpointPart } from "./viewpoint-part.js";

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
  /** A tour file by its path (the preview's clip and poster). */
  readonly load: (path: string) => Promise<Blob>;
  /** Makes `image` the video `itemId`'s poster: one undo step, a refusal
   *  said by the page. */
  readonly writePoster: (
    itemId: string,
    image: Blob,
  ) => Promise<TypedEditOutcome>;
  /** Its viewpoint set (null: a fresh one in front of it); absent: the
   *  page has no such edit, and no viewpoint is drawn. */
  readonly setViewpoint?: (
    itemId: string,
    viewpoint: TourPictureViewpoint | null,
  ) => TypedEditOutcome;
  /** Stand the 3D view's camera at its viewpoint; absent: no button. */
  readonly lookFrom?: (itemId: string) => void;
}

/** The words of a view whose name is not one capitalised. */
const VIEW_LABEL: Readonly<Record<string, string>> = {
  standHere: "Stand here",
};

/** A free video's views in the inspector's words, in the format's order. */
export const VIDEO_VIEW_CHOICES: readonly {
  readonly value: string;
  readonly label: string;
}[] = TOUR_FREE_BLOCK_VIEWS.video.map((view) => ({
  value: view,
  label: VIEW_LABEL[view] ?? view.charAt(0).toUpperCase() + view.slice(1),
}));

/** What a video's view does, under its choice. */
const VIEW_NOTE: Readonly<Record<string, string>> = {
  screen: "A screen on a stand, with its controls under it.",
  cutout:
    "The person or thing in it stands in the place, turning to the visitor.",
  porthole: "A round window with its poster; a tap opens the clip large.",
  window:
    "Plays inside a real window: place it exactly on the opening, its frame left clear.",
  standHere:
    "Footprints mark its viewpoint; standing there facing it, the picture develops on the wall and plays.",
};

/** What the stand-here view uses its viewpoint for. */
const STAND_HERE_USE =
  "Used by Stand here: footprints mark it on the ground, and the video develops while the visitor stands there facing it. Its Position below is where the picture is projected.";

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
    if (choice.name === "loop") {
      box.append(loopSwitch(choice.value === "on"));
      continue;
    }
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
  const status = captionsStatus(video.captions);
  if (status !== null) box.append(el("div", "note", `Captions: ${status}`));
  return box;
}

/** The loop: one switch, its press writing the other value. */
function loopSwitch(on: boolean): HTMLElement {
  const row = el("div", "vchips");
  const b = el("button", on ? "chip on" : "chip", "Loop");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(on));
  b.dataset["act"] = `video-set:loop:${on ? "off" : "on"}`;
  row.append(b);
  return row;
}

/** A free video's panel. */
export function createVideoPanel(deps: VideoPanelDeps): KindPanel {
  /** Whether its viewpoint section is drawn: a view seen from one, on a
   *  page that can write it. */
  const viewpointShown = (video: InspectorVideo): boolean =>
    deps.setViewpoint !== undefined &&
    tourSeenFromViewpoint("video", video.view);
  /** The preview of the selected clip, kept across draws; its key is the
   *  block and the clip's path. */
  let preview: { key: string; shown: VideoPreview } | null = null;
  const previewOf = (video: InspectorVideo): HTMLElement | null => {
    const key =
      video.clipPath === null ? null : `${video.blockId}|${video.clipPath}`;
    if (preview !== null && preview.key === key) return preview.shown.root;
    preview?.shown.dispose();
    preview = null;
    if (key === null || video.clipPath === null) return null;
    const { blockId } = video;
    const shown = videoPreview(document, video.clipPath, video.posterPath, {
      load: deps.load,
      usePoster: async (image) =>
        (await deps.writePoster(blockId, image)) === "written",
    });
    preview = { key, shown };
    return shown.root;
  };
  return {
    sync(item): KindPanelDraw | null {
      const video = item?.video ?? null;
      if (video === null) {
        preview?.shown.dispose();
        preview = null;
        return null;
      }
      return {
        key: JSON.stringify(video.viewpoint),
        kept: previewOf(video),
        ownsFields: false,
        title: () => null,
        head: () => [],
        parts: () =>
          viewpointShown(video)
            ? [
                videoParts(video),
                viewpointPart({
                  vp: video.viewpoint,
                  use: STAND_HERE_USE,
                  lookFromAct:
                    deps.lookFrom === undefined ? null : "video-look-from",
                  freshAct: "video-viewpoint-new",
                }),
              ]
            : [videoParts(video)],
      };
    },
    act(name, item, selected) {
      const video = item.video;
      if (video === null) return false;
      if (name === "video-viewpoint-new" || name === "video-look-from") {
        if (!viewpointShown(video)) return false;
        if (name === "video-viewpoint-new") {
          deps.setViewpoint?.(selected, null);
        } else {
          deps.lookFrom?.(selected);
        }
        return true;
      }
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
