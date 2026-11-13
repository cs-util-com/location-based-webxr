/**
 * The editor's list of kinds' panels: one row per kind of the format, the
 * kind's own part of the item inspector (`kind-panel.ts`) or null for a
 * kind whose fields (`kinds/edit-kinds.ts` `fields`) say all it needs.
 * It is the editor half of a kind's row: the words, the look, the fields
 * and the add line stay in `KIND_EDIT`, which the creator pages outside
 * the editor read too and so may not reach a panel's DOM. Keyed by the
 * format's kind type, so a kind the format gains and this list lacks is a
 * compile error here.
 *
 * `createKindPanels` makes the panels once for the shell and answers for
 * the selection: every panel follows it (so one whose kind is no longer
 * selected lets its own state go, a long text's preview), the selected
 * item's kind's panel draws, and a press goes to that panel first.
 *
 * @see kind-panels.ts.md
 */
import type { TourBlockKind } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { tourBlockKinds } from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { ShellEditCommands } from "../editor-shell/editor-shell.js";
import type { InspectorModel } from "../editor-shell/inspector-model.js";
import { createKeptStore } from "../long-text/kept-store.js";
import { createLongTextDock } from "../long-text/long-text-dock.js";
import { longTextPanel } from "../long-text/long-text-panel.js";
import type { ModelFocus, ModelPick } from "../editor-view.js";
import type { KindPanel, KindPanelDraw } from "./kind-panel.js";
import { createModelPanel } from "./model-panel.js";
import { createVideoPanel } from "./video-panel.js";

/** What the shell gives a kind's panel: its page, its edits and its
 *  words. */
export interface PanelContext {
  readonly document: Document;
  /** The 3D view's box (a panel may draw over it: a long text's
   *  preview). */
  readonly box: HTMLElement;
  /** The inspector's dock (a panel may make it wider). */
  readonly inspectorRoot: HTMLElement;
  /** The tree (a panel's drawing over the view keeps right of it). */
  readonly treeRoot: HTMLElement | null;
  readonly edits: Pick<
    ShellEditCommands,
    | "block"
    | "view"
    | "model"
    | "narration"
    | "editNarration"
    | "voiceMaxBytes"
    | "poster"
  >;
  /** A tour file by its path. */
  readonly loadPicture: (path: string) => Promise<Blob>;
  readonly say: (text: string) => void;
  /** A panel's state changed outside a draw: draw again. */
  readonly changed: () => void;
  /** The click the 3D view waits for on the selected model. */
  readonly pickAsked: (pick: ModelPick | null) => void;
  /** The selected model's part in focus. */
  readonly focused: (focus: ModelFocus | null) => void;
}

/** A long text's panel: its writer and its preview. */
function longText(ctx: PanelContext): KindPanel {
  return longTextPanel(
    createLongTextDock({
      document: ctx.document,
      box: ctx.box,
      inspectorRoot: ctx.inspectorRoot,
      treeRoot: ctx.treeRoot,
      kept: createKeptStore(),
      writeBody: (id, body) => ctx.edits.block(id, "body", body),
      writeView: (id, view) => ctx.edits.view(id, view),
      readNarration: (id) => ctx.edits.narration(id),
      editNarration: (id, change) => ctx.edits.editNarration(id, change),
      ...(ctx.edits.voiceMaxBytes === undefined
        ? {}
        : { voiceMaxBytes: ctx.edits.voiceMaxBytes }),
      loadPicture: ctx.loadPicture,
      say: ctx.say,
      changed: ctx.changed,
    }),
  );
}

/** A 3D model's panel: its size, view, clip, notes and sections. */
function model(ctx: PanelContext): KindPanel {
  return createModelPanel({
    editModel: (id, edit) => ctx.edits.model(id, edit),
    pickAsked: ctx.pickAsked,
    focused: ctx.focused,
  });
}

/** A free video's panel: its view, how it starts, its sound. */
function video(ctx: PanelContext): KindPanel {
  return createVideoPanel({
    writeView: (id, view) => ctx.edits.view(id, view),
    writeChoice: (id, field, value) => ctx.edits.block(id, field, value),
    load: ctx.loadPicture,
    writePoster: (id, image) =>
      ctx.edits.poster === undefined
        ? Promise.resolve("refused")
        : ctx.edits.poster(id, image),
  });
}

/** A kind's panel maker, or null for a kind without one. */
type KindPanelList = {
  readonly [K in TourBlockKind]: ((ctx: PanelContext) => KindPanel) | null;
};

/** THE list, in the format's order. */
export const KIND_PANELS = {
  shortText: null,
  longText,
  picture: null,
  video,
  audio: null,
  model,
  character: null,
} as const satisfies KindPanelList;

/** The shell's panels, answering for the selection. */
export interface KindPanels {
  /** Every panel follows `model`; the selected item's kind's draw, or
   *  null (no item selected, or its kind has no panel). */
  sync(model: InspectorModel | null): KindPanelDraw | null;
  /** A press (`data-act`) run by the selected item's kind's panel; false
   *  when it is not that panel's (or nothing is selected). */
  act(name: string, model: InspectorModel | null, selected: string): boolean;
  /** Every panel's typing written now. */
  flush(): void;
}

/** The panels of `list` (`KIND_PANELS`), made once with `ctx`. */
export function createKindPanels(
  ctx: PanelContext,
  list: KindPanelList = KIND_PANELS,
): KindPanels {
  const made = new Map<TourBlockKind, KindPanel>();
  for (const kind of tourBlockKinds()) {
    const make = list[kind];
    if (make !== null) made.set(kind, make(ctx));
  }
  return {
    sync(selection) {
      const item = selection?.kind === "item" ? selection : null;
      // Every panel follows; only the selected kind's draw is shown.
      let drawn: KindPanelDraw | null = null;
      for (const [kind, panel] of made) {
        const selected = item?.itemKind === kind;
        const draw = panel.sync(selected ? item : null);
        if (selected) drawn = draw;
      }
      return drawn;
    },
    act(name, selection, selected) {
      if (selection?.kind !== "item") return false;
      const panel = made.get(selection.itemKind);
      return panel?.act(name, selection, selected) ?? false;
    },
    flush() {
      for (const panel of made.values()) panel.flush();
    },
  };
}
